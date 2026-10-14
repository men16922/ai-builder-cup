import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';
import type { MobilityPlace, SimulatedJourney } from '@contracts/gcp/mobility';

type Point={lat:number;lng:number};
type MapInstance={panTo(point:Point):void};
type MarkerInstance={setPosition(point:Point):void;setMap(map:MapInstance|null):void};
type LineInstance={setPath(points:Point[]):void;setMap(map:MapInstance|null):void};
type MapsSdk={Map:new(node:HTMLElement,options:Record<string,unknown>)=>MapInstance;Marker:new(options:Record<string,unknown>)=>MarkerInstance;Polyline:new(options:Record<string,unknown>)=>LineInstance};
type MapsWindow=Window&{google?:{maps:MapsSdk};aideMapsReady?:()=>void};
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
/** Google tiles, private simulated coordinates and read-only markers. No browser key reaches the model. */
export default function GoogleJourneyMap({apiKey,latitude,longitude,journey,places=[]}:{apiKey:string;latitude:number;longitude:number;journey?:SimulatedJourney|null;places?:MobilityPlace[]}) {
  const {t}=useLanguage(),node=useRef<HTMLDivElement>(null),scene=useRef<{map:MapInstance;marker:MarkerInstance;line:LineInstance;places:MarkerInstance[]}|undefined>(undefined),[error,setError]=useState(false),[ready,setReady]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    void loadMaps(apiKey).then(sdk=>{
      if(cancelled||!node.current)return;
      const map=new sdk.Map(node.current,{center:{lat:latitude,lng:longitude},zoom:14,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,clickableIcons:false});
      scene.current={map,marker:new sdk.Marker({map,position:{lat:latitude,lng:longitude},title:t('가상 차량 위치','Simulated vehicle position')}),line:new sdk.Polyline({map,strokeColor:getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim(),strokeWeight:4}),places:[]};setReady(true);
    }).catch(()=>{if(!cancelled)setError(true);});
    return()=>{cancelled=true;scene.current?.marker.setMap(null);scene.current?.line.setMap(null);scene.current?.places.forEach(marker=>marker.setMap(null));scene.current=undefined;};
  },[apiKey]); // The scene follows coordinates without loading another map each simulation tick.
  useEffect(()=>{
    const current=scene.current, sdk=(window as MapsWindow).google?.maps;
    if(!current||!sdk)return;
    const position={lat:latitude,lng:longitude};current.marker.setPosition(position);current.map.panTo(position);
    current.line.setPath(journey?.destination?[{lat:journey.origin.latitude,lng:journey.origin.longitude},{lat:journey.destination.location.latitude,lng:journey.destination.location.longitude}]:[]);
    current.places.forEach(marker=>marker.setMap(null));
    current.places=places.map(place=>new sdk.Marker({map:current.map,position:{lat:place.location.latitude,lng:place.location.longitude},title:place.name}));
  },[latitude,longitude,journey,places,ready]);
  return <div className="aide-google-map"><div ref={node} className="aide-google-map-canvas" aria-label={t('Google 지도와 가상 차량 위치','Google map and simulated vehicle position')}/>{error?<p role="status">{t('Google 지도를 불러오지 못했습니다. 위치 좌표는 차량 상태에서 확인할 수 있습니다.','Google map could not load. Coordinates remain in the vehicle status.')}</p>:null}</div>;
}
