import type { CSSProperties } from "react";

export function Mark() {
  return <svg aria-hidden="true" width="30" height="32" viewBox="0 0 32 32" fill="currentColor">
    {Array.from({length:8}, (_,i) => <path key={i} transform={`rotate(${i*45} 16 16)`} d="M13.4 1h5.2l-1.2 10.3L16 15l-1.4-3.7z"/>)}
  </svg>;
}
export function Arrow({diagonal=false, back=false}: {diagonal?:boolean;back?:boolean}) {
  return <svg width="17" height="17" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" style={{transform:diagonal?"rotate(-45deg)":back?"rotate(180deg)":undefined} as CSSProperties}><path d="M3 10h13m-6-6 6 6-6 6"/></svg>;
}
export function Brand(){return <a href="/" className="brand" aria-label="Glyph home"><Mark/><span>Glyph</span></a>}
