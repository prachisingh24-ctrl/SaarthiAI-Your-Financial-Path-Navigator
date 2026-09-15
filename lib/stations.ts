// Prototype dispatch neighbors among stations represented in the worker roster.
// Regional links are informed by the Central Railway division map. Intermediate
// stops without roster records are omitted. Long inter-region gaps are excluded.
export const stationNeighbors:Record<string,string[]>={
 CSMT:['DR'],
 DR:['CSMT','TNA'],
 TNA:['DR','KYN','BSR'],
 KYN:['TNA','BSR'],
 BSR:['TNA','KYN'],
 LNL:['PUNE'],
 PUNE:['LNL'],
 IGP:['NK'],
 NK:['IGP'],
 SUR:[],
};
export function nearbyStations(reportingStation:string){return [reportingStation,...(stationNeighbors[reportingStation]||[])]}
export function isNearbyStation(workerStation:string,reportingStation:string){return nearbyStations(reportingStation).includes(workerStation)}
