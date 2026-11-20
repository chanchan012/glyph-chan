import { SignIn, SignUp } from "@clerk/nextjs";
import { clerkKeys } from "@/server/config";
import { Arrow, Brand } from "./marks";
import { SpecimenPlate } from "./specimen-plate";
import { specimens } from "@/lib/specimens";

export function AuthShell({signup=false}: {signup?:boolean}) {
  const keys = clerkKeys();
  return <div className="shell">
    <header className="mast"><div className="wrap mast-inner"><Brand/><a className="back-link" href="/"><Arrow back/> Foundry</a></div></header>
    <main className="wrap auth-main"><section className="auth-panel">
      <div className="eyebrow"><span className="tiny-line"/> GLYPH ACCOUNT</div>
      <h1>{signup?"Join the foundry.":"Welcome back."}</h1>
      {keys ? (signup?<SignUp routing="path" path="/sign-up" fallbackRedirectUrl="/dashboard"/>:<SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/dashboard"/>)
        :<p>Account access is awaiting configuration. The specimen lab is open to guests.</p>}
      <a className="primary" href="/demo">Continue as guest <Arrow diagonal/></a>
      <a className="text-link" href={signup?"/sign-in":"/sign-up"}>{signup?"Sign in":"Create an account"}</a>
    </section><aside className="auth-plate"><SpecimenPlate item={specimens[0]} guides/></aside></main>
  </div>;
}
