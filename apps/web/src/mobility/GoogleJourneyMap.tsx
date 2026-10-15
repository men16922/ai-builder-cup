import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';
import type { MobilityPlace, SimulatedJourney } from '@contracts/gcp/mobility';

type Point={lat:number;lng:number};
type Bounds={extend(point:Point):Bounds;contains(point:Point):boolean};
type MapInstance={panTo(point:Point):void;fitBounds(bounds:Bounds,padding?:number|{top:number;right:number;bottom:number;left:number}):void;getBounds():Bounds|undefined};
type MarkerInstance={setPosition(point:Point):void;setMap(map:MapInstance|null):void;setIcon(icon:unknown):void};
type LineInstance={setPath(points:Point[]):void;setMap(map:MapInstance|null):void};
type MapsSdk={Map:new(node:HTMLElement,options:Record<string,unknown>)=>MapInstance;Marker:new(options:Record<string,unknown>)=>MarkerInstance;Polyline:new(options:Record<string,unknown>)=>LineInstance;
  LatLngBounds:new()=>Bounds;Size:new(width:number,height:number)=>unknown;Point:new(x:number,y:number)=>unknown;SymbolPath:{CIRCLE:number}};
type MapsWindow=Window&{google?:{maps:MapsSdk};aideMapsReady?:()=>void};
type Scene={map:MapInstance;car:MarkerInstance;travelled:LineInstance;remaining:LineInstance;pins:MarkerInstance[];shown?:Point;heading?:number;frame?:number;framed?:string};
let loaded:Promise<MapsSdk>|undefined;
function loadMaps(key:string):Promise<MapsSdk> {
  if(loaded)return loaded;
  loaded=new Promise((resolve,reject)=>{
    const scope=window as MapsWindow;
    if(scope.google?.maps){resolve(scope.google.maps);return;}
    scope.aideMapsReady=()=>{if(scope.google?.maps)resolve(scope.google.maps);else reject(Error('maps_unavailable'));};
    const script=document.createElement('script');script.async=true;
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=quarterly&loading=async&callback=aideMapsReady`;
    script.onerror=()=>reject(Error('maps_unavailable'));
    document.head.append(script);
  });
  return loaded;
}
const primary=()=>getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim()||'#1f5fa8';
/** Top-down car drawn pointing north and rotated in SVG, because classic image markers cannot rotate. */
function carIcon(sdk:MapsSdk,heading:number) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="-4 -4 64 64"><circle cx="28" cy="28" r="30" fill="${primary()}" opacity=".14"/><circle cx="28" cy="28" r="22" fill="${primary()}" opacity=".12"/><g transform="rotate(${heading} 28 28)">`
    +`<ellipse cx="28" cy="30" rx="12" ry="20" fill="#000" opacity=".18"/><rect x="17" y="8" width="22" height="40" rx="9" fill="${primary()}" stroke="#fff" stroke-width="2.5"/>`
    +`<path d="M20.5 18Q28 13.5 35.5 18L34.2 24.5Q28 22.5 21.8 24.5Z" fill="#e3ecff"/><rect x="21.5" y="25.5" width="13" height="11" rx="3" fill="#fff" opacity=".14"/>`
    +`<path d="M21.5 38.5Q28 40.5 34.5 38.5L35 43Q28 45 21 43Z" fill="#e3ecff" opacity=".75"/><circle cx="21.5" cy="11" r="1.6" fill="#fff6c2"/><circle cx="34.5" cy="11" r="1.6" fill="#fff6c2"/></g></svg>`;
  return {url:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,scaledSize:new sdk.Size(64,64),anchor:new sdk.Point(32,32)};
}
/** Screen-space heading for short simulated legs, clockwise from north. */
function bearing(from:Point,to:Point) {
  const x=(to.lng-from.lng)*Math.cos(from.lat*Math.PI/180),y=to.lat-from.lat;
  return x===0&&y===0?0:(Math.atan2(x,y)*180/Math.PI+360)%360;
}
/** Quiet basemap so the route and the car carry the scene; follows the console theme. */
function mapStyles() {
  const theme=document.documentElement.dataset.theme,dark=theme==='dark'||theme!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  const hidden=[{featureType:'poi',stylers:[{visibility:'off'}]},{featureType:'transit',stylers:[{visibility:'off'}]}];
  return dark?[...hidden,{elementType:'geometry',stylers:[{color:'#1c2026'}]},{elementType:'labels.text.fill',stylers:[{color:'#8b929c'}]},{elementType:'labels.text.stroke',stylers:[{color:'#1c2026'}]},
    {featureType:'road',elementType:'geometry',stylers:[{color:'#2b313a'}]},{featureType:'road.highway',elementType:'geometry',stylers:[{color:'#39414d'}]},{featureType:'water',stylers:[{color:'#0e161f'}]}]
    :[...hidden,{elementType:'geometry',stylers:[{saturation:-70},{lightness:8}]},{featureType:'road',elementType:'geometry',stylers:[{saturation:-100},{lightness:40}]},{featureType:'water',stylers:[{saturation:-40},{lightness:20}]},{elementType:'labels.text.fill',stylers:[{saturation:-100},{lightness:20}]}];
}
/** Straight-line kilometres; the simulation never claims a road distance. */
function kilometres(from:Point,to:Point) {
  const rad=Math.PI/180,a=Math.sin((to.lat-from.lat)*rad/2)**2+Math.cos(from.lat*rad)*Math.cos(to.lat*rad)*Math.sin((to.lng-from.lng)*rad/2)**2;
  return 12742*Math.asin(Math.sqrt(a));
}
const point=(location:{latitude:number;longitude:number}):Point=>({lat:location.latitude,lng:location.longitude});
/** Google tiles, private simulated coordinates and read-only markers. No browser key reaches the model. */
export default function GoogleJourneyMap({apiKey,latitude,longitude,journey,places=[]}:{apiKey:string;latitude:number;longitude:number;journey?:SimulatedJourney|null;places?:MobilityPlace[]}) {
  const {t,locale}=useLanguage(),node=useRef<HTMLDivElement>(null),scene=useRef<Scene|undefined>(undefined),[error,setError]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    void loadMaps(apiKey).then(sdk=>{
      if(cancelled||!node.current)return;
      const map=new sdk.Map(node.current,{center:{lat:latitude,lng:longitude},zoom:15,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,clickableIcons:false,styles:mapStyles()});
      const color=primary();
      scene.current={map,pins:[],
        travelled:new sdk.Polyline({map,strokeColor:color,strokeOpacity:.95,strokeWeight:6,zIndex:2}),
        remaining:new sdk.Polyline({map,strokeOpacity:0,zIndex:1,icons:[{icon:{path:'M 0,-1 0,1',strokeColor:color,strokeOpacity:.7,strokeWeight:4,scale:3},offset:'0',repeat:'14px'}]}),
        car:new sdk.Marker({map,position:{lat:latitude,lng:longitude},icon:carIcon(sdk,0),zIndex:10,title:t('가상 차량 위치','Simulated vehicle position')})};
      setReady(true);
    }).catch(()=>{if(!cancelled)setError(true);});
    return()=>{cancelled=true;const current=scene.current;if(current?.frame)cancelAnimationFrame(current.frame);current?.car.setMap(null);current?.travelled.setMap(null);current?.remaining.setMap(null);current?.pins.forEach(marker=>marker.setMap(null));scene.current=undefined;};
  },[apiKey]); // The scene follows coordinates without loading another map each simulation tick.
  useEffect(()=>{
    const current=scene.current, sdk=(window as MapsWindow).google?.maps;
    if(!current||!sdk)return;
    const target={lat:latitude,lng:longitude},origin=journey?point(journey.origin):undefined,destination=journey?.destination?point(journey.destination.location):undefined;
    const heading=origin&&destination?Math.round(bearing(origin,destination)):current.heading??0;
    if(heading!==current.heading){current.car.setIcon(carIcon(sdk,heading));current.heading=heading;}
    current.pins.forEach(marker=>marker.setMap(null));
    current.pins=[...(journey?.state==='choosing'?places:[]).map(place=>new sdk.Marker({map:current.map,position:point(place.location),title:place.name})),
      ...(origin&&destination?[new sdk.Marker({map:current.map,position:origin,zIndex:3,icon:{path:sdk.SymbolPath.CIRCLE,scale:6,fillColor:'#fff',fillOpacity:1,strokeColor:primary(),strokeWeight:3}}),
        new sdk.Marker({map:current.map,position:destination,zIndex:4,title:journey?.destination?.name})]:[])];
    const frameKey=origin&&destination?`${journey?.id}|${journey?.destination?.id}`:undefined;
    if(frameKey&&current.framed!==frameKey){const bounds=new sdk.LatLngBounds();bounds.extend(origin!);bounds.extend(destination!);current.map.fitBounds(bounds,{top:150,right:56,bottom:48,left:56}); /* Keep the route clear of the driving HUD. */current.framed=frameKey;}
    else if(!frameKey){current.framed=undefined;current.map.panTo(target);}
    const draw=(position:Point)=>{
      current.car.setPosition(position);current.shown=position;
      current.travelled.setPath(origin&&destination?[origin,position]:[]);current.remaining.setPath(destination&&journey?.state!=='arrived'?[position,destination]:[]);
      if(frameKey&&current.map.getBounds()?.contains(position)===false)current.map.panTo(position);
    };
    if(current.frame)cancelAnimationFrame(current.frame);
    const from=current.shown??target,still=window.matchMedia('(prefers-reduced-motion: reduce)').matches||journey?.state!=='moving'&&journey?.state!=='arrived';
    if(still||(from.lat===target.lat&&from.lng===target.lng)){draw(target);return;}
    // Glide between server-confirmed positions; the server tick, not the animation, decides where the car is.
    const started=performance.now(),duration=1100;
    const step=(now:number)=>{
      const k=Math.min(1,(now-started)/duration);
      draw({lat:from.lat+(target.lat-from.lat)*k,lng:from.lng+(target.lng-from.lng)*k});
      current.frame=k<1?requestAnimationFrame(step):undefined;
    };
    current.frame=requestAnimationFrame(step);
  },[latitude,longitude,journey,places,ready]);
  const origin=journey?point(journey.origin):undefined,destination=journey?.destination,moving=journey?.state==='moving';
  const total=origin&&destination?kilometres(origin,point(destination.location)):0,left=destination?kilometres({lat:latitude,lng:longitude},point(destination.location)):0;
  const km=(value:number)=>value.toLocaleString(locale,{maximumFractionDigits:value<10?1:0});
  const hud=journey&&destination&&(moving||journey.state==='arrived')?<div className="aide-drive-hud" role="status" aria-label={t('주행 시뮬레이션 상태','Driving simulation status')}>
    <div className="aide-drive-hud-head"><span className={`aide-drive-dot${moving?' is-live':''}`}/><strong>{moving?t('주행 중','Driving'):t('도착','Arrived')}</strong><span className="aide-drive-dest">{destination.name}</span><span className="aide-drive-sim">SIM</span></div>
    <div className="aide-drive-track"><span style={{width:`${Math.round(journey.progress*100)}%`}}/></div>
    <dl><div><dt>{t('진행','Progress')}</dt><dd>{Math.round(journey.progress*100)}%</dd></div><div><dt>{t('남은 거리','Remaining')}</dt><dd>{km(left)} km</dd></div><div><dt>{t('직선 거리','Straight line')}</dt><dd>{km(total)} km</dd></div></dl>
  </div>:null;
  return <div className="aide-google-map">{hud}<div ref={node} className="aide-google-map-canvas" aria-label={t('Google 지도와 가상 차량 위치','Google map and simulated vehicle position')}/>{error?<p role="status">{t('Google 지도를 불러오지 못했습니다. 위치 좌표는 차량 상태에서 확인할 수 있습니다.','Google map could not load. Coordinates remain in the vehicle status.')}</p>:null}</div>;
}
