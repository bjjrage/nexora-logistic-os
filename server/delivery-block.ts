/** Client circuits are explicit: an absent policy is not an external circuit. */
export function deliveryBlock(provider:unknown){
 if(provider==='NEXORA')return null;
 return provider==='QUADMINDS'
  ?{reasonCode:'EXTERNAL_DELIVERY_PROVIDER',reason:'Reparto gestionado en QuadMinds'}
  :{reasonCode:'MISSING_DELIVERY_PROVIDER',reason:'Falta definir el sistema de reparto del cliente'};
}
