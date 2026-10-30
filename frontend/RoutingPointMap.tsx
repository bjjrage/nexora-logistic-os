import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
export default function RoutingPointMap({latitude,longitude,onPick}:{latitude?:number;longitude?:number;onPick:(latitude:number,longitude:number)=>void}){
 const root=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),marker=useRef<L.CircleMarker|null>(null),callback=useRef(onPick);callback.current=onPick;
 useEffect(()=>{
  if(!root.current)return;
  const current=L.map(root.current,{scrollWheelZoom:false}).setView([-25.30,-57.60],12);map.current=current;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(current);
  current.on('click',(event:L.LeafletMouseEvent)=>callback.current(event.latlng.lat,event.latlng.lng));
  const observer=new ResizeObserver(()=>current.invalidateSize());observer.observe(root.current);
  return()=>{observer.disconnect();current.remove();map.current=null;marker.current=null;};
 },[]);
 useEffect(()=>{
  if(!map.current||latitude===undefined||longitude===undefined)return;
  if(marker.current)marker.current.setLatLng([latitude,longitude]);
  else marker.current=L.circleMarker([latitude,longitude],{radius:9,color:'#ffffff',weight:3,fillColor:'#d21135',fillOpacity:1}).addTo(map.current);
  map.current.setView([latitude,longitude],16,{animate:false});
 },[latitude,longitude]);
 return <div><p className="muted">Tocá el lugar exacto de entrega o mové el mapa y usá su centro.</p><div ref={root} className="routing-point-map" role="region" aria-label="Mapa para elegir ubicación"/><button type="button" className="button button-secondary" onClick={()=>{const p=map.current?.getCenter();if(p)callback.current(p.lat,p.lng);}}>Usar centro del mapa</button></div>;
}
