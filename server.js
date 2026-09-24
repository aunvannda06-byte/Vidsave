// Vidsave: paste a public link -> list qualities -> download video (exact resolution), music (MP3), or subtitles (SRT).
// Needs yt-dlp + ffmpeg (see Dockerfile). Public content only: no cookies, no logins, no private-content access.
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{execFile}=require('child_process');
const PORT=process.env.PORT||3000,MAX_MB=+process.env.MAX_MB||500,MAX_JOBS=+process.env.MAX_JOBS||3,TMP=fs.mkdtempSync(path.join(os.tmpdir(),'vs-'));
const HOSTS=/(^|\.)(youtube\.com|youtu\.be|facebook\.com|fb\.watch|fb\.com|tiktok\.com|instagram\.com|twitter\.com|x\.com|t\.me|snapchat\.com|reddit\.com|redd\.it|pinterest\.[a-z.]+|pin\.it|threads\.net|threads\.com)$/i;
const YT_HOSTS=/(^|\.)(youtube\.com|youtu\.be)$/i;
const jobs=new Map(),hits=new Map();let running=0;
const json=(r,c,o)=>{r.writeHead(c,{'Content-Type':'application/json'});r.end(JSON.stringify(o))};

// YouTube now frequently answers the default "web" client with a bot-check wall ("Sign in to confirm
// you're not a bot") even for fully public videos. Impersonating other official player clients avoids
// it without needing cookies/login. If the first combo still gets bot-checked, retry once with another.
const YT_CLIENT_SETS=[['--extractor-args','youtube:player_client=tv,web_safari'],['--extractor-args','youtube:player_client=web_safari,android']];
const hostOf=u=>{try{return new URL(u).hostname}catch(e){return ''}};
const clientSetsFor=url=>YT_HOSTS.test(hostOf(url))?YT_CLIENT_SETS:[[]];

const okUrl=u=>{try{
  const x=new URL(u);
  if(!/^https?:$/.test(x.protocol)||!HOSTS.test(x.hostname))return null;
  if(/(^|\.)t\.me$/i.test(x.hostname))x.pathname=x.pathname.replace(/^\/s\//,'/'); // t.me/s/<ch>/<id> preview links -> t.me/<ch>/<id>, which yt-dlp's extractor matches
  return x.href;
}catch(e){return null}};

const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<60000);a.push(n);hits.set(ip,a);return a.length>20};

// Order matters: check the bot-check phrasing before the broader "private/login" patterns, since
// YouTube's bot-check message itself contains "sign in" and would otherwise be mis-labelled 'private'.
const why=s=>{
  if(/confirm (you.?re|you are) not a bot|sign in to confirm/i.test(s))return 'bot';
  if(/private|log ?in|cookies|members|not available|age.?restrict/i.test(s))return 'private';
  if(/max-filesize|larger than/i.test(s))return 'toolarge';
  if(/unsupported url|no extractor/i.test(s))return 'unsupported';
  if(/no video formats|requested format not available|unable to extract.*video|no formats found|nonetype.*subscript|has no attribute/i.test(s))return 'nomedia';
  return 'failed';
};
const safe=t=>String(t||'video').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/\s+/g,' ').trim().slice(0,80)||'video';

function ytdlpJSON(url,extra){return new Promise((ok,no)=>execFile('yt-dlp',['-J','--no-playlist','--no-warnings',...extra,url],{timeout:60000,maxBuffer:64e6},(e,out,err)=>{
  if(e)return no(new Error(String(err||'')+' '+e.message));
  try{ok(JSON.parse(out))}catch(x){no(new Error('failed to parse yt-dlp output'))}
}))}

function buildInfo(j){
  const F=j.formats||[],ab=F.filter(f=>f.vcodec==='none'&&f.acodec&&f.acodec!=='none').sort((a,b)=>(b.abr||0)-(a.abr||0))[0],asz=ab?(ab.filesize||ab.filesize_approx||0):0,by={};
  F.filter(f=>f.vcodec&&f.vcodec!=='none'&&f.height).forEach(f=>{const size=(f.filesize||f.filesize_approx||0)+(f.acodec==='none'?asz:0),o=by[f.height];if(!o||(f.tbr||0)>o.tbr)by[f.height]={height:f.height,size,tbr:f.tbr||0}});
  let videos=Object.values(by).sort((a,b)=>b.height-a.height).map(({height,size})=>({height,size}));
  if(!videos.length&&j.height)videos=[{height:j.height,size:j.filesize||j.filesize_approx||0}];

  const subs={};
  for(const [k,v] of Object.entries(j.subtitles||{}))subs[k]={lang:k,name:(v[0]&&v[0].name)||k,auto:false};
  for(const [k,v] of Object.entries(j.automatic_captions||{}))if(!subs[k])subs[k]={lang:k,name:(v[0]&&v[0].name)||k,auto:true};
  const PRI=['km','en'];
  const subtitles=Object.values(subs).sort((a,b)=>((PRI.indexOf(a.lang)+1)||99)-((PRI.indexOf(b.lang)+1)||99)||a.lang.localeCompare(b.lang)).slice(0,24);

  return {title:j.title||'video',thumb:j.thumbnail||'',duration:j.duration||0,source:j.extractor_key||'',videos,audioSize:Math.round((j.duration||0)*16000),subtitles}
}

async function info(url){
  let lastErr;
  for(const extra of clientSetsFor(url)){
    try{return buildInfo(await ytdlpJSON(url,extra))}
    catch(e){lastErr=e;if(why(e.message)!=='bot')break}
  }
  console.error('[info]',url,lastErr&&lastErr.message);
  throw new Error(why(lastErr?lastErr.message:''));
}

function runDownload(args){return new Promise((ok,no)=>execFile('yt-dlp',args,{timeout:600000,maxBuffer:16e6},(e,so,se)=>{
  if(e)return no(new Error(String(se||'')+' '+e.message));ok()
}))}

function buildArgs(url,type,h,lang,base,extra){
  const a=['--no-playlist','--no-warnings',...extra];
  if(type==='subtitle')a.push('--skip-download','--write-subs','--write-auto-subs','--sub-langs',lang,'--sub-format','srt/vtt','--convert-subs','srt','-o',base+'.%(ext)s');
  else if(type==='audio')a.push('--max-filesize',MAX_MB+'M','-x','--audio-format','mp3','--audio-quality','0','-o',base+'.%(ext)s');
  else a.push('--max-filesize',MAX_MB+'M','-f',`bv*[height=${h}]+ba/b[height=${h}]`,'--merge-output-format','mp4','-o',base+'.%(ext)s');
  a.push(url);return a;
}

async function prepare(id,url,type,h,lang,title){
  const job=jobs.get(id),base=path.join(TMP,id);
  let lastErr;
  for(const extra of clientSetsFor(url)){
    try{await runDownload(buildArgs(url,type,h,lang,base,extra));lastErr=null;break}
    catch(e){lastErr=e;if(why(e.message)!=='bot')break}
  }
  running--;
  const f=fs.readdirSync(TMP).find(x=>x.startsWith(id+'.')&&!/\.(part|ytdl)$/.test(x));
  if(lastErr||!f){job.state='error';job.msg=why(lastErr?lastErr.message:'');console.error('[prepare]',id,url,lastErr&&lastErr.message);return}
  const ext=path.extname(f).slice(1),suffix=type==='audio'?'':type==='subtitle'?` [${lang}]`:` ${h}p`;
  Object.assign(job,{state:'ready',file:path.join(TMP,f),ext,size:fs.statSync(path.join(TMP,f)).size,name:safe(title)+suffix+'.'+ext});
}

const CT={mp3:'audio/mpeg',mp4:'video/mp4',srt:'application/x-subrip',vtt:'text/vtt'};

setInterval(()=>{const n=Date.now();for(const [id,j] of jobs)if(n-j.t>15*60000){if(j.file)fs.unlink(j.file,()=>{});jobs.delete(id)}},60000).unref();

http.createServer((q,r)=>{const u=new URL(q.url,'http://x'),ip=(q.headers['x-forwarded-for']||q.socket.remoteAddress||'').split(',')[0].trim();
  if(u.pathname==='/api/info'){if(limited(ip))return json(r,429,{error:'busy'});const url=okUrl(u.searchParams.get('url')||'');if(!url)return json(r,400,{error:'unsupported'});
    return info(url).then(d=>json(r,200,d),e=>json(r,422,{error:e.message}))}
  if(u.pathname==='/api/prepare'&&q.method==='POST'){let b='';q.on('data',c=>{b+=c;if(b.length>5e3)q.destroy()});q.on('end',()=>{let m;try{m=JSON.parse(b)}catch(e){return json(r,400,{})}
    const url=okUrl(m.url||''),h=+m.h,type=m.type==='audio'?'audio':m.type==='subtitle'?'subtitle':'video',lang=String(m.lang||'').slice(0,10);
    if(!url||(type==='video'&&!(Number.isInteger(h)&&h>0&&h<10000))||(type==='subtitle'&&!lang))return json(r,400,{error:'unsupported'});
    if(limited(ip)||running>=MAX_JOBS)return json(r,503,{error:'busy'});
    const id=crypto.randomBytes(9).toString('hex');jobs.set(id,{state:'working',t:Date.now()});running++;
    prepare(id,url,type,h,lang,m.title); // fire and forget; poll /api/job/:id
    json(r,200,{id})});return}
  let m=u.pathname.match(/^\/api\/job\/(\w+)$/);
  if(m){const j=jobs.get(m[1]);return j?json(r,200,{state:j.state,msg:j.msg,size:j.size}):json(r,404,{state:'error',msg:'failed'})}
  m=u.pathname.match(/^\/api\/file\/(\w+)$/);
  if(m){const j=jobs.get(m[1]);if(!j||j.state!=='ready')return json(r,404,{});
    const ascii=j.name.replace(/[^\x20-\x7e]/g,'_');
    r.writeHead(200,{'Content-Type':CT[j.ext]||'application/octet-stream','Content-Length':j.size,'Content-Disposition':`attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(j.name)}`});
    const s=fs.createReadStream(j.file);s.pipe(r);r.on('close',()=>{s.destroy()});r.on('finish',()=>{fs.unlink(j.file,()=>{});jobs.delete(m[1])});return}
  fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{if(e){r.writeHead(500);return r.end('index.html not found')}r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(d)})
}).listen(PORT,()=>console.log('Vidsave on '+PORT));
