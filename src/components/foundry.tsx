"use client";

import { useRef, useState, type CSSProperties } from "react";
import { specimens } from "@/lib/specimens";
import { Arrow, Brand } from "./marks";
import { SpecimenPlate } from "./specimen-plate";

export function Foundry({demo=false}: {demo?: boolean}) {
  const [index, choose] = useState(0);
  const [guides, setGuides] = useState(true);
  const [outline, setOutline] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const item = specimens[index];
  function showIndex(){dialog.current?.showModal()}
  return <div className="shell">
    <header className="mast"><div className="wrap mast-inner"><Brand/><nav aria-label="Main navigation">
      <a className="home-nav" href="/" aria-current={demo?undefined:"page"}>Foundry</a>
      <button className="index-nav" onClick={showIndex}>Specimen index</button>
      <a className="dashboard-nav" href="/dashboard">Dashboard</a>
      <a className="sign-link" href="/sign-in">Sign in <Arrow diagonal/></a>
    </nav></div></header>
    <main className="wrap landing">
      <section className="hero">
        <div className="intro">
          <div className="eyebrow"><span className="tiny-line"/>{demo?"GUEST SPECIMEN LAB":"COLLABORATIVE TYPE FOUNDRY"}</div>
          <h1>{demo?<>Specimen<br/><em>lab.</em></>:<>Type takes<br/><em>shape.</em></>}</h1>
          <p>{demo?"Inspect each letterform in outline, toggle its optical guides, and compare the four specimen studies.":"A shared workspace for humans and AI to shape letterforms, draw vector icons, and build custom typefaces."}</p>
          <div className="hero-actions">{demo?<><a className="primary" href="/studio/demo">Open in Studio <Arrow diagonal/></a><button className="text-link" aria-pressed={outline} onClick={()=>setOutline(!outline)}>{outline?"Show fill":"Show outline"}</button></>:<><a className="primary" href="/demo">Open guest demo <Arrow diagonal/></a><button className="text-link" onClick={showIndex}>Browse specimens</button></>}</div>
        </div>
        <figure className="plate" style={{"--plate":item.ink,"--letter":item.color} as CSSProperties}>
          <figcaption><span><i/>SPECIMEN VIEW</span><span>FIG. 0{index+1} / 04</span></figcaption>
          <div className="drawing"><SpecimenPlate item={item} guides={guides} outline={outline}/></div>
          <div className="plate-foot"><span>{item.name} <b>/</b> U+{item.code}</span><button aria-pressed={guides} onClick={()=>setGuides(!guides)}><span className="guide-icon">⌗</span> Guides {guides?"on":"off"}</button></div>
        </figure>
      </section>
      <section className="collection" aria-label="Specimen collection">
        <div className="collection-head"><h2>Specimen index</h2><span>04 STUDIES</span></div>
        <div className="studies">{specimens.map((s,i)=><button key={s.name} className={"study"+(i===index?" selected":"")} aria-pressed={i===index} onClick={()=>choose(i)}>
          <svg viewBox="0 0 240 240" aria-hidden="true" style={{background:s.color,color:s.ink}}><path d={s.path} fill="currentColor" fillRule="evenodd"/></svg>
          <span><strong>{s.name}</strong><small>{s.style}</small></span><span className="study-arrow"><Arrow diagonal/></span>
        </button>)}</div>
      </section>
    </main>
    <footer className="foot"><div className="wrap"><span>GLYPH FOUNDRY</span><span>TYPE &amp; VECTOR STUDIO</span></div></footer>
    <dialog ref={dialog} className="index-dialog" onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close()}}>
      <div className="dialog-head"><h2>Specimen index</h2><button autoFocus aria-label="Close specimen index" onClick={()=>dialog.current?.close()}>×</button></div>
      {specimens.map((s,i)=><button className="dialog-row" key={s.name} onClick={()=>{choose(i);dialog.current?.close()}}><span className="chip" style={{background:s.color,color:s.ink}}>{s.char}</span><span>{s.name}<small>{s.style}</small></span><Arrow/></button>)}
    </dialog>
  </div>;
}
