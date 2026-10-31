import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
type Row=Record<string,any>;
export default function RouteItineraryMap({report,selected,onSelect}:{report:Row;selected:number|null;onSelect:(index:number)=>void}){
 const root=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),pins=useRef<L.Marker[]>([]),callback=useRef(onSelect);callback.current=onSelect;
 const fit=()=>{const current=map.current;if(!current)return;const points: L.LatLngExpression[]=report.geometry?.coordinates.map((p:number[])=>[p[1],p[0]])??report.stops.filter((s:Row)=>s.latitude!=null&&s.longitude!=null).map((s:Row)=>[s.latitude,s.longitude]);if(report.depot)points.push([report.depot.latitude,report.depot.longitude]);if(points.length)current.fitBounds(L.latLngBounds(points),{padding:[45,45],maxZoom:16,animate:false});};
 useEffect(()=>{
  if(!root.current)return;const current=L.map(root.current,{preferCanvas:true}).setView([-25.30,-57.60],12);map.current=current;
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(current);
  if(report.geometry){const points=report.geometry.coordinates.map((p:number[])=>[p[1],p[0]] as L.LatLngTuple);L.polyline(points,{color:'#fff',weight:9,opacity:.95}).addTo(current);L.polyline(points,{color:'#135ac2',weight:5,opacity:1}).addTo(current);}
  const add=(latitude:number,longitude:number,label:string,title:string,approximate=false)=>{const marker=L.marker([latitude,longitude],{title,icon:L.divIcon({className:'itinerary-pin'+(approximate?' itinerary-pin--approximate':''),html:`<span>${label}</span>`,iconSize:[34,34],iconAnchor:[17,17]})}).addTo(current);const content=document.createElement('span');content.textContent=title;marker.bindPopup(content);return marker;};
  if(report.depot)add(report.depot.latitude,report.depot.longitude,'D',report.depot.label+' · Salida y regreso');
  pins.current=[];report.stops.forEach((s:Row,index:number)=>{if(s.latitude==null||s.longitude==null)return;const marker=add(s.latitude,s.longitude,String(index+1),`${index+1}. ${s.reference} · ${s.recipientName}`,!['EXACT','CONFIRMED'].includes(s.precision));marker.on('click',()=>callback.current(index));pins.current[index]=marker;});
  fit();const observer=new ResizeObserver(()=>{current.invalidateSize();if(root.current?.clientWidth&&root.current.clientHeight)fit();});observer.observe(root.current);
  return()=>{observer.disconnect();current.remove();map.current=null;pins.current=[];};
 },[report]);
 useEffect(()=>{if(selected==null)return;const marker=pins.current[selected];if(marker&&map.current){map.current.setView(marker.getLatLng(),16);marker.openPopup();}},[selected]);
 return <div className="itinerary-map-wrap"><div ref={root} className="itinerary-map" role="region" aria-label="Mapa grande del recorrido"/><button className="button button-secondary itinerary-fit" type="button" onClick={fit}>Ver recorrido completo</button></div>;
}
