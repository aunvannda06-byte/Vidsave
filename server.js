// Vidsave: paste a public link -> list qualities -> download video (exact resolution) or music (MP3). Needs yt-dlp + ffmpeg (see Dockerfile).
// Public content only: no cookies, no logins, no private-content access.
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{execFile}=require('child_process');
const PORT=process.env.PORT||3000,MAX_MB=+process.env.MAX_MB||500,MAX_JOBS=+process.env.MAX_JOBS||3,TMP=fs.mkdtempSync(path.join(os.tmpdir(),'vs-'));
const HOSTS=/(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.watch|fb\.com|tiktok\.com|instagram\.com|twitter\.com|x\.com|t\.me|snapchat\.com|reddit\.com|redd\.it|pinterest\.[a-z.]+|pin\.it|threads\.net|threads\.com)$/i;
const jobs=new Map(),hits=new Map();let running=0;
const json=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};
const okUrl=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)&&HOSTS.test(x.hostname)?x.href:null}catch(e){return null}};
const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<60000);a.push(n);hits.set(ip,a);return a.length>20};
const why=s=>/private|log ?in|sign in|cookies|members|not available|age/i.test(s)?'private':/unsupported url/i.test(s)?'unsupported':/max-filesize|larger than/i.test(s)?'toolarge':'failed';
const safe=t=>String(t||'video').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/\s+/g,' ').trim().slice(0,80)||'video';

function info(url){return new Promise((ok,no)=>execFile('yt-dlp',['-J','--no-playlist','--no-warnings',url],{timeout:60000,maxBuffer:64e6},(e,out,err)=>{
  if(e)return no(new Error(why(err+e.message)));let j;try{j=JSON.parse(out)}catch(x){return no(new Error('failed'))}
  const F=j.formats||[],ab=F.filter(f=>f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0))[0],asz=ab?(ab.filesize||ab.filesize_approx||0):0,by={};
  F.filter(f=>f.vcodec&&f.vcodec!=='none'&&f.height).forEach(f=>{const size=(f.filesize||f.filesize_approx||0)+(f.acodec==='none'?asz:0),o=by[f.height];if(!o||(f.tbr||0)>o.tbr)by[f.height]={height:f.height,size,tbr:f.tbr||0}});
  let videos=Object.values(by).sort((a,b)=>b.height-a.height).map(({height,size})=>({height,size}));
  if(!videos.length&&j.height)videos=[{height:j.height,size:j.filesize||j.filesize_approx||0}];
  ok({title:j.title||'video',thumb:j.thumbnail||'',duration:j.duration||0,source:j.extractor_key||'',videos,audioSize:Math.round((j.duration||0)*16000)})}))}

function prepare(url,type,h,title){const id=crypto.randomBytes(9).toString('hex'),job={state:'working',t:Date.now()};jobs.set(id,job);running++;
  const base=path.join(TMP,id),a=['--no-playlist','--no-warnings','--max-filesize',MAX_MB+'M','-o',base+'.%(ext)s'];
  if(type==='audio')a.push('-x','--audio-format','mp3','--audio-quality','0');
  else a.push('-f',`bv*[height=${h}]+ba/b[height=${h}]`,'--merge-output-format','mp4');
  a.push(url);
  execFile('yt-dlp',a,{timeout:600000,maxBuffer:16e6},(e,so,se)=>{running--;
    const f=fs.readdirSync(TMP).find(x=>x.startsWith(id+'.')&&!/\.(part|ytdl)$/.test(x));
    if(e||!f){job.state='error';job.msg=why(String(se)+(e?e.message:''));return}
    const ext=path.extname(f).slice(1);Object.assign(job,{state:'ready',file:path.join(TMP,f),ext,size:fs.statSync(path.join(TMP,f)).size,name:safe(title)+(type==='audio'?'':` ${h}p`)+'.'+ext})});
  return id}

setInterval(()=>{const n=Date.now();for(const [id,j] of jobs)if(n-j.t>15*60000){if(j.file)fs.unlink(j.file,()=>{});jobs.delete(id)}},60000).unref();

http.createServer((q,r)=>{const u=new URL(q.url,'http://x'),ip=(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim();
  if(u.pathname==='/api/info'){if(limited(ip))return json(r,429,{error:'busy'});const url=okUrl(u.searchParams.get('url')||'');if(!url)return json(r,400,{error:'unsupported'});
    return info(url).then(d=>json(r,200,d),e=>json(r,422,{error:e.message}))}
  if(u.pathname==='/api/prepare'&&q.method==='POST'){let b='';q.on('data',c=>{b+=c;if(b.length>5e3)q.destroy()});q.on('end',()=>{let m;try{m=JSON.parse(b)}catch(e){return json(r,400,{})}
    const url=okUrl(m.url||''),h=+m.h,type=m.type==='audio'?'audio':'video';
    if(!url||(type==='video'&&!(Number.isInteger(h)&&h>0&&h<10000)))return json(r,400,{error:'unsupported'});
    if(limited(ip)||running>=MAX_JOBS)return json(r,503,{error:'busy'});json(r,200,{id:prepare(url,type,h,m.title)})});return}
  let m=u.pathname.match(/^\/api\/job\/(\w+)$/);
  if(m){const j=jobs.get(m[1]);return j?json(r,200,{state:j.state,msg:j.msg,size:j.size}):json(r,404,{state:'error',msg:'failed'})}
  m=u.pathname.match(/^\/api\/file\/(\w+)$/);
  if(m){const j=jobs.get(m[1]);if(!j||j.state!=='ready')return json(r,404,{});
    const ascii=j.name.replace(/[^\x20-\x7e]/g,'_');
    r.writeHead(200,{'Content-Type':j.ext==='mp3'?'audio/mpeg':j.ext==='mp4'?'video/mp4':'application/octet-stream','Content-Length':j.size,'Content-Disposition':`attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(j.name)}`});
    const s=fs.createReadStream(j.file);s.pipe(r);r.on('close',()=>{s.destroy()});r.on('finish',()=>{fs.unlink(j.file,()=>{});jobs.delete(m[1])});return}
  fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){r.writeHead(500);return r.end('index.html not found')}r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(d)})
}).listen(PORT,()=>console.log('Vidsave on '+PORT));
