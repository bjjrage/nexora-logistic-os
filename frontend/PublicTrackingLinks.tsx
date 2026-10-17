export default function PublicTrackingLinks({codes}:{codes:string[]}) {
  const valid=codes.filter(code=>/^B-[0-9A-F]{20}$/.test(code));
  if(!valid.length)return null;
  return <div className="stack"><strong>Seguimiento para el destinatario</strong><small>Compartí uno de estos enlaces para consultar el estado del pedido sin iniciar sesión.</small>{valid.map(code=>{
    const url=`https://nexoralogisticpy.netlify.app/seguimiento/#codigo=${encodeURIComponent(code)}`;
    return <a className="text-button" key={code} href={url} target="_blank" rel="noopener noreferrer">{code} ↗</a>;
  })}</div>;
}
