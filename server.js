const express=require('express'),fs=require('fs'),path=require('path'),os=require('os');
const {execFile}=require('child_process');
const app=express(),WS=path.join(__dirname,'workspace'),SESS=path.join(WS,'.session.RData');
const OUT=path.join(WS,'outputs'),PD=path.join(WS,'.projects'),TP=path.join(WS,'.templates.json');
fs.mkdirSync(WS,{recursive:true});fs.mkdirSync(OUT,{recursive:true});fs.mkdirSync(PD,{recursive:true});
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
attach(list(setwd=function(...)invisible(NULL)),name="ide_shims",warn.conflicts=FALSE)
if(file.exists(${S(SESS)}))load(${S(SESS)},envir=e)
if(file.exists(${S(SESS+'.pkgs')}))for(p in readLines(${S(SESS+'.pkgs')}))try(suppressPackageStartupMessages(library(p,character.only=TRUE)),silent=TRUE)
png(file.path(${S(dir)},"plot%03d.png"),width=900,height=560,res=110)
try(source(${S(dir+'/script.R')},echo=FALSE,print.eval=TRUE))
invisible(while(!is.null(dev.list()))dev.off())
n<-ls(e);save(list=n,file=${S(SESS)},envir=e)
writeLines(setdiff(.packages(),c("stats","graphics","grDevices","utils","datasets","methods","base")),${S(SESS+'.pkgs')})
cat(vapply(n,function(k){o<-get(k,e);sprintf("%s\\t%s\\t%s",k,class(o)[1],if(!is.null(dim(o)))paste(dim(o),collapse=" x ") else length(o))},""),sep="\\n",file=${S(dir+'/env.txt')})`);
  proc=execFile('Rscript',['--no-save','--no-restore',dir+'/runner.R'],{cwd:WS,timeout:60000,maxBuffer:5e6},(err,stdout,stderr)=>{
    proc=null;
    const plots=fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort().map(f=>fs.readFileSync(path.join(dir,f)).toString('base64'));
    let env=[];try{env=fs.readFileSync(dir+'/env.txt','utf8').split('\n').filter(Boolean).map(l=>l.split('\t'))}catch{}
    if(q.body.tag){fs.mkdirSync(OUT+'/figures',{recursive:true});fs.readdirSync(dir).filter(f=>f.endsWith('.png')).sort().forEach((f,i)=>fs.copyFileSync(path.join(dir,f),`${OUT}/figures/${safe(q.body.tag)}_${i+1}.png`))}
    fs.rmSync(dir,{recursive:true,force:true});
    r.json({stdout,stderr,plots,env,error:err?(err.killed?'Execution stopped or timed out':err.code==='ENOENT'?'Rscript is not installed on the server':null):null});});});
app.post('/api/stop',(q,r)=>{if(proc)proc.kill();r.json({})});
app.post('/api/reset',(q,r)=>{fs.rmSync(SESS,{force:true});fs.rmSync(SESS+'.pkgs',{force:true});r.json({})});
app.get('/api/packages',(q,r)=>{if(pk)return r.json(pk);
  execFile('Rscript',['-e','ip<-installed.packages();cat(paste(ip[,1],ip[,3],sep="\\t"),sep="\\n")'],(e,o)=>{pk=(o||'').split('\n').filter(Boolean).map(l=>l.split('\t'));r.json(pk)})});
const MODES={plan:'Read the assignment materials and extract the requirements and a reproducible analysis plan. Follow the instruction document literally: use its exact variable names, table specifications, thresholds, file names and comment rules, put the relevant requirement in each step desc, and do not invent variables or methods it does not mention. If Thai text looks garbled, rely on the English code samples and table specifications. Follow the packages and code style the instructions require (for example gtsummary, dplyr native pipe).  Only recode a sentinel value such as 99 to NA in variables whose codebook entry defines it as unknown or missing; never in continuous variables where it can be a real value (for example weight 99 kg). Never call setwd(): data files are in the working directory. Respect naming rules such as variable suffixes.',step:'Write reproducible R code for the step. The data frame is df. Use base R or tidyverse; no interactive code. Only recode a sentinel value such as 99 to NA in variables whose codebook entry defines it as unknown or missing; never in continuous variables where it can be a real value (for example weight 99 kg). Never call setwd(): data files are in the working directory. Follow any naming rules and comment style the instructions require.',check:'Check whether the outputs meet the assignment instructions and rubric.',generate:'Write R code for the request. If text is selected in the editor, it is context.',fix:'Fix the R code. Use the error message if given. Return the full corrected code.',refactor:'Refactor the R code for clarity and idiomatic style (tidyverse where sensible) without changing behavior.',explain:'Explain what the R code does, concisely, for a researcher.',interpret:'Interpret this R statistical output: key estimates, significance, assumptions, caveats.',suggest:'Suggest appropriate statistical methods for this data and goal, with R functions to use.'};
app.post('/api/ai',async(q,r)=>{
  const key=process.env.AI_API_KEY||process.env.OPENAI_API_KEY;if(!key)return r.status(400).json({error:'Set AI_API_KEY on the server'});
  const {mode,prompt='',code='',error='',env='',ctx=''}=q.body;
  const files=fs.readdirSync(WS).filter(f=>!f.startsWith('.')).map(f=>/\.(csv|tsv)$/i.test(f)?f+' (header: '+fs.readFileSync(path.join(WS,f),'utf8').split('\n')[0].slice(0,300)+')':f).join('; ');
  const text=['explain','interpret','suggest','plan','check'].includes(mode);
  const sys=`You are the code assistant inside an R IDE used by researchers. Working-directory files: ${files||'none'}. Objects in the R session: ${env||'none'}. ${ctx.slice(0,45000)} ${MODES[mode]||''} `+(text?'Answer in plain text, concise.':'Reply with ONE ```r code block of complete runnable code (ggplot2 for plots) with brief comments, then at most two sentences.');
  const user=[prompt&&'Request: '+prompt,error&&'Error:\n'+error,code&&'Code/Output:\n'+code].filter(Boolean).join('\n\n')||'Help.';
  try{
    const x=await fetch((process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:process.env.AI_MODEL||process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0.2,messages:[{role:'system',content:sys},{role:'user',content:user}]})});
    const j=await x.json();if(!x.ok)return r.status(500).json({error:(Array.isArray(j)?j[0]:j).error?.message||'AI provider error'});
    r.json({text:j.choices[0].message.content});
  }catch(e){r.status(500).json({error:e.message})}});
app.use('/outputs',express.static(OUT));
app.post('/api/upload',(q,r)=>{const n=safe(q.body.name);fs.writeFileSync(path.join(WS,n),Buffer.from(q.body.b64,'base64'));r.json({name:n})});
app.get('/api/text',(q,r)=>{const n=safe(q.query.name),f=path.join(WS,n),done=(e,o)=>r.json({text:String(o||'').slice(0,60000),error:e?String(e.message).slice(0,200):null});
  if(/\.pdf$/i.test(n))return execFile('pdftotext',['-layout',f,'-'],{maxBuffer:5e7},done);
  if(/\.xlsx?$/i.test(n))return execFile('Rscript',['-e',`for(s in readxl::excel_sheets("${f}")){cat("## sheet:",s,"\\n");write.csv(head(readxl::read_excel("${f}",sheet=s),300),stdout(),row.names=FALSE)}`],{maxBuffer:5e7},done);
  try{done(null,fs.readFileSync(f,'utf8'))}catch{r.status(404).json({error:'Not found'})}});
app.get('/api/outputs',(q,r)=>{const ls=d=>{try{return fs.readdirSync(d)}catch{return[]}};r.json({tables:ls(OUT).filter(f=>f.endsWith('.csv')),figures:ls(OUT+'/figures')})});
app.get('/api/projects',(q,r)=>r.json(fs.readdirSync(PD).map(f=>f.replace(/\.json$/,''))));
app.get('/api/project',(q,r)=>{try{r.json(JSON.parse(fs.readFileSync(path.join(PD,safe(q.query.name)+'.json'),'utf8')))}catch{r.json(null)}});
app.post('/api/project',(q,r)=>{fs.writeFileSync(path.join(PD,safe(q.body.name)+'.json'),JSON.stringify(q.body.data));r.json({})});
app.get('/api/templates',(q,r)=>{try{r.json(JSON.parse(fs.readFileSync(TP,'utf8')))}catch{r.json([])}});
app.post('/api/templates',(q,r)=>{fs.writeFileSync(TP,JSON.stringify(q.body.list||[]));r.json({})});
app.post('/api/export',(q,r)=>{fs.writeFileSync(OUT+'/report.md',q.body.markdown||'');execFile('pandoc',['report.md','-o','report.docx','--resource-path=.'],{cwd:OUT},e=>e?r.status(500).json({error:'pandoc failed: '+e.message}):r.json({url:'/outputs/report.docx'}))});
app.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)));
