const express=require('express'),fs=require('fs'),path=require('path'),os=require('os');
const {execFile}=require('child_process');
const app=express();
const WS=path.join(__dirname,'workspace');fs.mkdirSync(WS,{recursive:true});
if(!fs.readdirSync(WS).length)fs.writeFileSync(path.join(WS,'script.R'),'# Welcome to R Analytics Studio\nsummary(mtcars)\nplot(mtcars$wt, mtcars$mpg, main="Weight vs MPG", pch=19)\n');
app.use(express.json({limit:'25mb'}));
if(process.env.APP_PASSWORD)app.use((req,res,next)=>{
  const p=Buffer.from((req.headers.authorization||'').slice(6),'base64').toString().split(':').slice(1).join(':');
  if(p===process.env.APP_PASSWORD)return next();
  res.set('WWW-Authenticate','Basic realm="R Studio"').status(401).send('Password required');});
app.use(express.static(path.join(__dirname,'public')));
const safe=n=>path.basename(String(n||'file')).replace(/[^\w.\- ]/g,'_');
app.get('/api/files',(q,r)=>r.json(fs.readdirSync(WS).filter(f=>!f.startsWith('.'))));
app.get('/api/file',(q,r)=>{try{r.json({content:fs.readFileSync(path.join(WS,safe(q.query.name)),'utf8')})}catch{r.status(404).json({error:'Not found'})}});
app.post('/api/files',(q,r)=>{const n=safe(q.body.name);fs.writeFileSync(path.join(WS,n),q.body.content||'');r.json({name:n})});
app.post('/api/run',(q,r)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r-'));
  fs.writeFileSync(dir+'/script.R',q.body.code||'');
  fs.writeFileSync(dir+'/runner.R',`png(file.path("${dir}","plot%03d.png"),width=900,height=560,res=110)\nsource("${dir}/script.R",echo=FALSE,print.eval=TRUE)\ninvisible(while(!is.null(dev.list()))dev.off())`);
  execFile('Rscript',['--no-save','--no-restore',dir+'/runner.R'],{cwd:WS,timeout:30000,maxBuffer:5e6},(err,stdout,stderr)=>{
    const plots=fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort().map(f=>fs.readFileSync(path.join(dir,f)).toString('base64'));
    fs.rmSync(dir,{recursive:true,force:true});
    r.json({stdout,stderr,plots,error:err?(err.killed?'Timed out after 30s':err.code==='ENOENT'?'Rscript is not installed on the server':'Exited with code '+err.code):null});});});
app.post('/api/ai',async(q,r)=>{
  const key=process.env.AI_API_KEY||process.env.OPENAI_API_KEY;if(!key)return r.status(400).json({error:'Set AI_API_KEY on the server'});
  const {mode,prompt='',code='',error=''}=q.body;const files=fs.readdirSync(WS).join(', ');
  const sys=`You are an expert R programmer inside an IDE. Data files in the working directory: ${files||'none'}. Prefer base R, ggplot2, dplyr. `+(mode==='explain'?'Explain the code clearly and concisely for a beginner.':'Reply with ONE ```r code block containing complete runnable code with brief comments, then at most two sentences of notes.');
  const user=mode==='generate'?`${prompt}\n\nCurrent code:\n${code}`:mode==='fix'?`Fix this R code.\nError:\n${error||'(none given; find bugs)'}\n\nCode:\n${code}`:`Explain:\n${code}`;
  try{
    const x=await fetch((process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:process.env.AI_MODEL||process.env.OPENAI_MODEL||'gpt-4o-mini',messages:[{role:'system',content:sys},{role:'user',content:user}]})});
    const j=await x.json();if(!x.ok)return r.status(500).json({error:(Array.isArray(j)?j[0]:j).error?.message||'AI provider error'});
    r.json({text:j.choices[0].message.content});
  }catch(e){r.status(500).json({error:e.message})}});
app.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)));
