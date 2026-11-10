const express=require('express'),fs=require('fs'),path=require('path'),os=require('os');
const {execFile}=require('child_process');
const app=express(),WS=path.join(__dirname,'workspace'),SESS=path.join(WS,'.session.RData');
fs.mkdirSync(WS,{recursive:true});
if(!fs.readdirSync(WS).some(f=>/\.R$/i.test(f)))fs.writeFileSync(path.join(WS,'script.R'),'# R Analytics Studio\nfit <- lm(mpg ~ wt, data = mtcars)\nsummary(fit)\nplot(mtcars$wt, mtcars$mpg, pch = 19)\nabline(fit)\n');
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
let proc=null,pk=null;
app.post('/api/run',(q,r)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'r-')),S=JSON.stringify;
  fs.writeFileSync(dir+'/script.R',q.body.code||'');
  fs.writeFileSync(dir+'/runner.R',`e<-globalenv()
if(file.exists(${S(SESS)}))load(${S(SESS)},envir=e)
png(file.path(${S(dir)},"plot%03d.png"),width=900,height=560,res=110)
try(source(${S(dir+'/script.R')},echo=FALSE,print.eval=TRUE))
invisible(while(!is.null(dev.list()))dev.off())
n<-ls(e);save(list=n,file=${S(SESS)},envir=e)
cat(vapply(n,function(k){o<-get(k,e);sprintf("%s\\t%s\\t%s",k,class(o)[1],if(!is.null(dim(o)))paste(dim(o),collapse=" x ") else length(o))},""),sep="\\n",file=${S(dir+'/env.txt')})`);
  proc=execFile('Rscript',['--no-save','--no-restore',dir+'/runner.R'],{cwd:WS,timeout:60000,maxBuffer:5e6},(err,stdout,stderr)=>{
    proc=null;
    const plots=fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort().map(f=>fs.readFileSync(path.join(dir,f)).toString('base64'));
    let env=[];try{env=fs.readFileSync(dir+'/env.txt','utf8').split('\n').filter(Boolean).map(l=>l.split('\t'))}catch{}
    fs.rmSync(dir,{recursive:true,force:true});
    r.json({stdout,stderr,plots,env,error:err?(err.killed?'Execution stopped or timed out':err.code==='ENOENT'?'Rscript is not installed on the server':null):null});});});
app.post('/api/stop',(q,r)=>{if(proc)proc.kill();r.json({})});
app.post('/api/reset',(q,r)=>{fs.rmSync(SESS,{force:true});r.json({})});
app.get('/api/packages',(q,r)=>{if(pk)return r.json(pk);
  execFile('Rscript',['-e','ip<-installed.packages();cat(paste(ip[,1],ip[,3],sep="\\t"),sep="\\n")'],(e,o)=>{pk=(o||'').split('\n').filter(Boolean).map(l=>l.split('\t'));r.json(pk)})});
const MODES={generate:'Write R code for the request. If text is selected in the editor, it is context.',fix:'Fix the R code. Use the error message if given. Return the full corrected code.',refactor:'Refactor the R code for clarity and idiomatic style (tidyverse where sensible) without changing behavior.',explain:'Explain what the R code does, concisely, for a researcher.',interpret:'Interpret this R statistical output: key estimates, significance, assumptions, caveats.',suggest:'Suggest appropriate statistical methods for this data and goal, with R functions to use.'};
app.post('/api/ai',async(q,r)=>{
  const key=process.env.AI_API_KEY||process.env.OPENAI_API_KEY;if(!key)return r.status(400).json({error:'Set AI_API_KEY on the server'});
  const {mode,prompt='',code='',error='',env=''}=q.body;
  const files=fs.readdirSync(WS).filter(f=>!f.startsWith('.')).map(f=>/\.(csv|tsv)$/i.test(f)?f+' (header: '+fs.readFileSync(path.join(WS,f),'utf8').split('\n')[0].slice(0,300)+')':f).join('; ');
  const text=['explain','interpret','suggest'].includes(mode);
  const sys=`You are the code assistant inside an R IDE used by researchers. Working-directory files: ${files||'none'}. Objects in the R session: ${env||'none'}. ${MODES[mode]||''} `+(text?'Answer in plain text, concise.':'Reply with ONE ```r code block of complete runnable code (ggplot2 for plots) with brief comments, then at most two sentences.');
  const user=[prompt&&'Request: '+prompt,error&&'Error:\n'+error,code&&'Code/Output:\n'+code].filter(Boolean).join('\n\n')||'Help.';
  try{
    const x=await fetch((process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:process.env.AI_MODEL||process.env.OPENAI_MODEL||'gpt-4o-mini',messages:[{role:'system',content:sys},{role:'user',content:user}]})});
    const j=await x.json();if(!x.ok)return r.status(500).json({error:(Array.isArray(j)?j[0]:j).error?.message||'AI provider error'});
    r.json({text:j.choices[0].message.content});
  }catch(e){r.status(500).json({error:e.message})}});
app.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)));
