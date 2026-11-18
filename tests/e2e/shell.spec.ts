import { test, expect } from "@playwright/test";

for (const [width,height] of [[1440,900],[1024,768],[768,1024],[390,844],[320,568],[844,390]]) {
  test(`shell and auth fit ${width} × ${height}`, async ({page})=>{
    await page.setViewportSize({width,height});
    for(const route of ["/","/sign-in","/sign-up","/demo"]) {
      await page.goto(route);
      await page.evaluate(()=>document.fonts.ready);
      const metrics=await page.evaluate(()=>{
        const root=document.documentElement;
        const controls=[...document.querySelectorAll<HTMLElement>("main a,main button,main h1,main figure")].filter(el=>el.offsetWidth>0 && el.offsetHeight>0);
        return {width:root.scrollWidth,height:root.scrollHeight, shell:document.querySelector(".shell")!.getBoundingClientRect().height,
          clipped:controls.filter(el=>{const b=el.getBoundingClientRect();return b.top<0||b.bottom>innerHeight+1||b.left<0||b.right>innerWidth+1}).map(el=>el.textContent)};
      });
      expect(metrics,{message:route}).toEqual({width,height,shell:height,clipped:[]});
    }
  });
}
test("guest can browse the index, inspect optical guides, and enter outline view",async({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:"Browse specimens"}).click();
  await page.getByRole("dialog").getByRole("button",{name:/Orbit Symbols/}).click();
  await expect(page.getByRole("img",{name:"Orbit Symbols glyph ✳"})).toBeVisible();
  await page.getByRole("button",{name:/Guides on/}).click();
  await expect(page.getByRole("button",{name:/Guides off/})).toHaveAttribute("aria-pressed","false");
  await page.getByRole("link",{name:"Open guest demo"}).click();
  await page.getByRole("button",{name:"Show outline"}).click();
  await expect(page.getByRole("button",{name:"Show fill"})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:/Axial Grotesk Grotesk sans/}).click();
  await expect(page.getByRole("img",{name:"Axial Grotesk glyph R"})).toBeVisible();
});
test("auth shell offers a working guest path",async({page,request})=>{
  await page.goto("/sign-in");
  await page.getByRole("link",{name:"Continue as guest"}).click();
  await expect(page).toHaveURL(/\/demo$/);
  expect(await (await request.get("/api/session")).json()).toEqual({mode:"guest"});
  expect((await request.get("/api/account")).status()).toBe(401);
});
