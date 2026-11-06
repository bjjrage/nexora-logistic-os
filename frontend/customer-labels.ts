const states:Record<string,string>={
  AVAILABLE:'Disponible',RESERVED:'Reservado',VEHICLE:'En vehículo',QUARANTINE:'En cuarentena',
  DELIVERED:'Entregado',ADJUSTED:'Ajustado',DRAFT:'Borrador',PARTIALLY_LOADED:'Carga parcial',
  LOADED:'Cargado',IN_TRANSIT:'En camino',PARTIAL:'Entrega parcial',CANCELLED:'Cancelado',EXCEPTION:'Incidencia'
};
export const movementLabels:Record<string,string>={RECEIVE:'Ingreso',MOVE:'Traslado',ADJUST:'Ajuste',RESERVE:'Reserva',RELEASE:'Liberación',LOAD:'Carga',UNLOAD:'Descarga',DELIVER:'Entrega',RETURN:'Devolución'};
export const customerState=(state:string)=>states[state]??state;
export const customerBadge=(state:string)=>'badge '+(['AVAILABLE','DELIVERED'].includes(state)?'badge-success':['QUARANTINE','PARTIAL','PARTIALLY_LOADED','EXCEPTION'].includes(state)?'badge-warning':state==='CANCELLED'?'badge-danger':'badge-neutral');
