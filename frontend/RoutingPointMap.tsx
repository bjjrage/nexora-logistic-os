import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
export default function RoutingPointMap({latitude,longitude,bounds,zoom=16,onPick}:{latitude?:number;longitude?:number;bounds?:number[];zoom?:number;onPick:(latitude:number,longitude:number)=>void}){
 const root=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),marker=useRef<L.Marker|null>(null),callback=useRef(onPick);callback.current=onPick;
 useEffect(()=>{
  if(!root.current)return;
  const current=L.map(root.current,{scrollWheelZoom:false}).setView([-25.30,-57.60],12);map.current=current;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(current);
  current.on('click',(event:L.LeafletMouseEvent)=>callback.current(event.latlng.lat,event.latlng.lng));
  const observer=new ResizeObserver(()=>current.invalidateSize());observer.observe(root.current);
  return()=>{observer.disconnect();current.remove();map.current=null;marker.current=null;};
 },[]);
 useEffect(()=>{
  if(!map.current)return;
  if(latitude===undefined||longitude===undefined){marker.current?.remove();marker.current=null;return;}
  if(marker.current)marker.current.setLatLng([latitude,longitude]);
  else{marker.current=L.marker([latitude,longitude],{draggable:true,title:'Arrastrar para ajustar la ubicación',icon:L.icon({iconUrl,iconRetinaUrl,shadowUrl,iconSize:[25,41],iconAnchor:[12,41],shadowSize:[41,41]})}).addTo(map.current);marker.current.on('dragend',()=>{const p=marker.current!.getLatLng();callback.current(p.lat,p.lng);});}
  if(bounds?.length===4&&bounds.every(Number.isFinite)&&bounds[0]<=bounds[1]&&bounds[2]<=bounds[3])map.current.fitBounds([[bounds[0],bounds[2]],[bounds[1],bounds[3]]],{padding:[25,25],maxZoom:zoom,animate:false});
  else map.current.setView([latitude,longitude],zoom,{animate:false});
 },[latitude,longitude,bounds,zoom]);
 return <div ref={root} className="routing-point-map" role="region" aria-label="Mapa para elegir ubicación"/>;
}
