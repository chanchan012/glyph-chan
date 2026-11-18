import type { Specimen } from "@/lib/specimens";

export function SpecimenPlate({item, guides, outline=false}: {item: Specimen; guides: boolean; outline?:boolean}) {
  const anchors = Array.from(item.path.matchAll(/([MLC]) ([\d ]+)/g), match => {
    const coords = match[2].trim().split(/ +/).map(Number);
    return coords.slice(-2);
  });
  return <svg className="plate-svg" role="img" aria-label={item.name + " glyph " + item.char} viewBox="0 0 500 278">
    {guides && <g className="guides">
      {[["ASC",32],["x–H",64],["BASE",225],["DESC",249]].map(([label,y])=><g key={label}><line x1="15" x2="485" y1={y} y2={y}/><text x="17" y={Number(y)-5}>{label}</text></g>)}
      <path d="M168 14v246m157-246v246" strokeDasharray="3 4"/>
    </g>}
    <g transform="translate(133 25)">
      <path d={item.path} fillRule="evenodd" fill={outline?"none":"var(--letter)"} stroke="var(--letter)" strokeWidth=".9"/>
      {guides && <g aria-hidden="true">
        {item.handles.map(([x,y])=><g key={x+"-"+y}><line x1={item.anchor[0]} y1={item.anchor[1]} x2={x} y2={y} stroke="#fff1ce" strokeWidth="1"/><circle cx={x} cy={y} r="2.1" fill="#fff1ce"/></g>)}
        {anchors.map(([x,y],i)=><rect key={i} x={x-1.75} y={y-1.75} width="3.5" height="3.5" fill="var(--plate)" stroke="#fff1ce" strokeWidth=".9"/>)}
      </g>}
    </g>
  </svg>;
}
