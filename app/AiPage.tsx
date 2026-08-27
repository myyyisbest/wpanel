'use client';

import { useCallback, useEffect, useState } from 'react';

type Proposal = { action:string; target:string };
type ContainerLite = { name:string; running:boolean };

const actionLabel:{[action:string]:string} = { start:'启动', stop:'停止', restart:'重启' };

export default function AiPage({ token, notify, containers, onChanged }:{ token:string;notify:(type:'ok'|'err',message:string)=>void;containers:ContainerLite[];onChanged:()=>void }) {
  const [settings,setSettings] = useState({ baseUrl:'', apiKey:'', model:'' });
  const [hasKey,setHasKey] = useState(false);
  const [savedKey,setSavedKey] = useState('');
  const [busy,setBusy] = useState('');
  const [diagName,setDiagName] = useState('');
  const [diagResult,setDiagResult] = useState('');
  const [need,setNeed] = useState('');
  const [proposals,setProposals] = useState<Proposal[]|null>(null);
  const [composePrompt,setComposePrompt] = useState('');
  const [composeYaml,setComposeYaml] = useState('');
  const [composeName,setComposeName] = useState('');
  const [composeDir,setComposeDir] = useState('');

  const post = useCallback(async (action:string,body:Record<string,unknown>) => {
    const response = await fetch(`${__WPANEL_API__}/api/ai/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(body)});
    const result = await response.json() as {content?:string;actions?:Proposal[];error?:string};
    if (!response.ok) throw new Error(result.error || '请求失败');
    return result;
  },[token]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const response = await fetch(`${__WPANEL_API__}/api/ai/settings`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
        const data = await response.json() as {baseUrl?:string;model?:string;hasKey?:boolean};
        setSettings(current => ({ ...current, baseUrl:data.baseUrl || '', model:data.model || '' }));
        setHasKey(Boolean(data.hasKey));setSavedKey(data.hasKey ? '已保存' : '');
      } catch { /* 首次加载失败静默 */ }
      try {
        const response = await fetch(`${__WPANEL_API__}/api/compose/projects`,{headers:{'X-WPanel-Token':token},cache:'no-store'});
        const data = await response.json() as {dir?:string};
        if (response.ok) setComposeDir(data.dir || '');
      } catch { /* 编排目录获取失败时保存功能不可用 */ }
    })();
  },[token]);

  async function saveSettings() {
    setBusy('保存设置');
    try {
      const keyToSend = settings.apiKey || (hasKey ? '__KEEP__' : '');
      const response = await fetch(`${__WPANEL_API__}/api/ai/settings`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify({ ...settings, apiKey:keyToSend })});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '保存失败');
      notify('ok','AI 设置已保存');setHasKey(true);setSavedKey('已保存');setSettings(current=>({...current,apiKey:''}));
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'保存失败'); }
    finally { setBusy(''); }
  }

  async function diagnose() {
    if (!diagName) return;
    setBusy('诊断中');setDiagResult('');
    try { const result = await post('diagnose',{name:diagName}); setDiagResult(result.content || ''); }
    catch (reason) { notify('err',reason instanceof Error?reason.message:'诊断失败'); }
    finally { setBusy(''); }
  }

  async function plan() {
    if (!need.trim()) return;
    setBusy('生成计划');setProposals(null);
    try { const result = await post('plan',{prompt:need}); setProposals(result.actions || []); }
    catch (reason) { notify('err',reason instanceof Error?reason.message:'生成失败'); }
    finally { setBusy(''); }
  }

  async function execute(proposal:Proposal,index:number) {
    setBusy(`执行 ${proposal.action} ${proposal.target}`);
    try {
      const response = await fetch(`${__WPANEL_API__}/api/containers/${encodeURIComponent(proposal.target)}/${proposal.action}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:'{}'});
      const result = await response.json() as {error?:string};
      if (!response.ok) throw new Error(result.error || '执行失败');
      setProposals(current => current ? current.filter((_,i)=>i!==index) : current);
      notify('ok',`${actionLabel[proposal.action]} ${proposal.target} 已执行`);onChanged();
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'执行失败'); }
    finally { setBusy(''); }
  }

  async function generateCompose() {
    if (!composePrompt.trim()) return;
    setBusy('生成 compose');setComposeYaml('');
    try { const result = await post('generate-compose',{prompt:composePrompt}); setComposeYaml(result.content || '');if(!composeName)setComposeName('ai-app'); }
    catch (reason) { notify('err',reason instanceof Error?reason.message:'生成失败'); }
    finally { setBusy(''); }
  }

  async function saveCompose() {
    if (!composeYaml.trim()) return;
    const name = (composeName || 'ai-app').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name)) { notify('err','项目名仅限字母数字与连字符'); return; }
    if (!composeDir) { notify('err','编排目录不可用'); return; }
    if (!window.confirm(`保存为编排项目「${name}」？之后可在「编排」页一键启动。`)) return;
    setBusy('保存项目');
    try {
      const call = async (action:string,body:Record<string,unknown>) => {
        const response = await fetch(`${__WPANEL_API__}/api/files/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-WPanel-Token':token},body:JSON.stringify(body)});
        const result = await response.json() as {error?:string};
        if (!response.ok) throw new Error(result.error || '保存失败');
      };
      await call('mkdir',{path:`${composeDir}/${name}`});
      await call('save',{path:`${composeDir}/${name}/compose.yaml`,content:composeYaml});
      notify('ok',`已保存到编排目录「${name}」`);
    } catch (reason) { notify('err',reason instanceof Error?reason.message:'保存失败'); }
    finally { setBusy(''); }
  }

  return <section className="file-wrap">
    <div className="section-title"><div><h2>AI 助手</h2><p>AI 只提供建议；所有动作都需你确认后才执行</p></div>{busy&&<span className="working">{busy}…</span>}</div>

    <div className="ai-grid">
      <article className="metric-card">
        <div className="metric-head"><span className="metric-icon violet">⚙</span><span className="tag neutral">OpenAI 兼容</span></div>
        <p>接口设置</p>
        <div className="ai-form">
          <label>接口地址<input className="ai-input" value={settings.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event)=>setSettings(current=>({...current,baseUrl:event.target.value}))}/></label>
          <label>密钥 {savedKey&&<small style={{color:'var(--ok-ink)'}}>{savedKey}（留空保持不变）</small>}<input className="ai-input" type="password" value={settings.apiKey} placeholder={hasKey?'••••••••':'sk-...'} onChange={(event)=>setSettings(current=>({...current,apiKey:event.target.value}))}/></label>
          <label>模型<input className="ai-input" value={settings.model} placeholder="gpt-4o-mini" onChange={(event)=>setSettings(current=>({...current,model:event.target.value}))}/></label>
          <button className="mini-button" disabled={Boolean(busy)||!settings.baseUrl||!settings.model||(!settings.apiKey&&!hasKey)} onClick={saveSettings}>保存设置</button>
        </div>
        <small style={{color:'var(--faint)',fontSize:10,display:'block',marginTop:8}}>密钥保存在本机 data/ai.local.json，不会上传；AI 无法执行任何命令，只能给出建议。</small>
      </article>

      <article className="metric-card">
        <div className="metric-head"><span className="metric-icon blue">✚</span><span className="tag neutral">只读</span></div>
        <p>容器日志诊断</p>
        <div className="ai-form">
          <select className="ai-select" value={diagName} onChange={(event)=>setDiagName(event.target.value)}>
            <option value="">选择容器…</option>
            {containers.map((item)=><option key={item.name} value={item.name}>{item.name}（{item.running?'运行中':'已停止'}）</option>)}
          </select>
          <button className="mini-button" disabled={Boolean(busy)||!diagName} onClick={diagnose}>AI 诊断</button>
        </div>
        {diagResult&&<pre className="ai-result">{diagResult}</pre>}
      </article>

      <article className="metric-card">
        <div className="metric-head"><span className="metric-icon green">✎</span><span className="tag neutral">确认后执行</span></div>
        <p>运维操作提议</p>
        <textarea className="ai-textarea" rows={2} value={need} placeholder="例如：把停止的 mage 容器重新启动" onChange={(event)=>setNeed(event.target.value)}/>
        <button className="mini-button" disabled={Boolean(busy)||!need.trim()} onClick={plan}>生成操作计划</button>
        {proposals&&<div className="ai-proposals">
          {proposals.length===0&&<small className="card-empty">AI 认为该需求无法用容器启停表达。</small>}
          {proposals.map((proposal,index)=><div className="svc-row" key={index}>
            <span>{actionLabel[proposal.action]||proposal.action} <strong>{proposal.target}</strong></span>
            <span className="svc-right"><button className="mini-button" disabled={Boolean(busy)} onClick={()=>execute(proposal,index)}>执行</button><button className="mini-button ghost" onClick={()=>setProposals(current=>current?current.filter((_,i)=>i!==index):current)}>忽略</button></span>
          </div>)}
        </div>}
      </article>

      <article className="metric-card">
        <div className="metric-head"><span className="metric-icon amber">◈</span><span className="tag neutral">生成</span></div>
        <p>Compose 生成</p>
        <textarea className="ai-textarea" rows={2} value={composePrompt} placeholder="例如：跑一个 memcached，限制内存 256m，暴露 11211" onChange={(event)=>setComposePrompt(event.target.value)}/>
        <button className="mini-button" disabled={Boolean(busy)||!composePrompt.trim()} onClick={generateCompose}>生成 compose.yaml</button>
        {composeYaml&&<div className="ai-form">
          <textarea className="ai-textarea" rows={8} value={composeYaml} onChange={(event)=>setComposeYaml(event.target.value)} spellCheck={false}/>
          <label style={{display:'flex',gap:8,alignItems:'center'}}>项目名<input className="ai-input" style={{flex:1}} value={composeName} onChange={(event)=>setComposeName(event.target.value)}/></label>
          <button className="mini-button" disabled={Boolean(busy)} onClick={saveCompose}>保存到编排目录</button>
        </div>}
      </article>
    </div>
  </section>;
}
