import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../apps/web/src/theme.generated.css';
import '../../apps/web/src/styles.css';
import {LanguageProvider,LanguageSelector,useLanguage} from '../../apps/web/src/i18n';
import MobilityWorkspace from '../../apps/web/src/mobility/MobilityWorkspace';
import {MobilityClient} from '../../apps/web/src/mobility/mobility-client';

// Test-only identity; the actual API verifies its fixture membership. Never imported by the product.
const client=new MobilityClient(async(path,input)=>{
  const response=await fetch('/api/organizations/v1/synthetic-org/workspaces/synthetic-workspace/gcp'+path,{
    method:input?'POST':'GET',headers:{Authorization:'Bearer synthetic-driver',...(input?{'Content-Type':'application/json','Idempotency-Key':input.key}:{})},
    ...(input?{body:JSON.stringify(input.body)}:{}),
  });
  const body=await response.json();if(!response.ok)throw Object.assign(Error(body.code??'mobility_request_failed'),{status:response.status});return body;
});
function TestWorkspace(){
  const [page,setPage]=React.useState<'vehicle'|'journey'|'calls'|'assistance'>('vehicle'),[kind,setKind]=React.useState<'restaurant'|'charging'|'poi'>('restaurant'),{t}=useLanguage();
  return <main style={{maxWidth:1180,margin:'0 auto',padding:'24px 20px'}}><p className="ops-caption">Offline synthetic UI verification</p><LanguageSelector/>
    <nav aria-label="Mobility fixture navigation"><button onClick={()=>setPage('vehicle')}>{t('내 차량','My vehicle')}</button><button onClick={()=>setPage('journey')}>{t('충전·지도','Charging & map')}</button><button onClick={()=>setPage('assistance')}>{t('차량 진단','Vehicle diagnosis')}</button><button onClick={()=>setPage('calls')}>{t('통화','Calls')}</button></nav>
    <MobilityWorkspace client={client} page={page} journeyKind={kind} onNavigate={(next,value)=>{if(value)setKind(value);setPage(next);}}/>
  </main>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><LanguageProvider><TestWorkspace/></LanguageProvider></React.StrictMode>);
