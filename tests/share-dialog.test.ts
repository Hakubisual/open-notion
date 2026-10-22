import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/features/lazy/share-dialog.js", import.meta.url), "utf8");

test("share tab publishes and copies once, reuses published URLs, and keeps detailed settings", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("<!doctype html><body></body>", { headers: { "content-type": "text/html" } }) });
  const browser = new Bun.WebView();
  try {
    await browser.navigate(server.url.href);
    await browser.evaluate(`(() => {
      window.access = {role:'full',people:[],requests:[],agents:[],settings:{},publish:null};
      window.calls = []; window.copied = []; window.failPublish = false; window.failCopy = false;
      window.fetch = async (url, options = {}) => {
        calls.push([url, options.method || 'GET']);
        if (url === '/api/profile') return {ok:true,json:async()=>({email:'owner@example.com'})};
        if (options.method === 'POST') {
          if (failPublish) return {ok:false,status:500,json:async()=>({error:'Publish failed'})};
          access.publish = {url:'/p/public-token'};
          return {ok:true,json:async()=>({ok:true,url:access.publish.url})};
        }
        return {ok:true,json:async()=>structuredClone(access)};
      };
      Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async text => {if (failCopy) throw Error('denied'); copied.push(text);}}});
      window.changed = (check) => new Promise((resolve,reject) => {
        const timer = setTimeout(()=>{ observer.disconnect(); reject(Error('dialog state timeout')); },3000);
        const observer = new MutationObserver(()=>{if(check()){clearTimeout(timer);observer.disconnect();resolve(true);}});
        observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});
      });
      ${source}
      window.openShare = async () => {
        const ready = changed(()=>!!document.querySelector('[data-general]'));
        AcardShare.open('a page'); await ready;
      };
    })()`);
    await browser.evaluate("openShare()");
    expect(await browser.evaluate("!!document.querySelector('[data-publish-copy]')")).toBe(true);
    await browser.evaluate(`(async()=>{
      const done = changed(()=>copied.length === 1 && !!document.querySelector('.shd-status').textContent);
      document.querySelector('[data-publish-copy]').click();
      document.querySelector('[data-publish-copy]').click();
      await done;
    })()`);
    const publicUrl = new URL("/p/public-token", server.url).href;
    expect(await browser.evaluate("({copied,calls:calls.filter(c=>c[1] === 'POST'),status:document.querySelector('.shd-status').textContent})")).toEqual({ copied: [publicUrl], calls: [["/api/page/a%20page/access/publish", "POST"]], status: expect.stringContaining(publicUrl) });
    await browser.evaluate(`(async()=>{
      const done = changed(()=>copied.length === 2);
      document.querySelector('[data-publish-copy]').click(); await done;
    })()`);
    expect(await browser.evaluate("({copied,posts:calls.filter(c=>c[1]==='POST').length})")).toEqual({ copied: [publicUrl, publicUrl], posts: 1 });
    await browser.evaluate("document.querySelector('[data-tab=publish]').click()");
    expect(await browser.evaluate("[...document.querySelectorAll('[data-setting]')].map(n=>n.dataset.setting)")).toEqual(["publishSubpages", "allowIndex"]);
    expect(await browser.evaluate("!!document.querySelector('[data-unpublish]')")).toBe(true);

    await browser.evaluate("(() => { access.publish = null; failPublish = true; return openShare(); })()");
    await browser.evaluate(`(async()=>{const done = changed(()=>!!document.querySelector('.shd-status.err'));document.querySelector('[data-publish-copy]').click();await done;})()`);
    expect(await browser.evaluate("({copies:copied.length,disabled:document.querySelector('[data-publish-copy]').disabled})")).toEqual({ copies: 2, disabled: false });

    await browser.evaluate("(() => { failPublish = false; failCopy = true; return openShare(); })()");
    await browser.evaluate(`(async()=>{const done = changed(()=>!!document.querySelector('.shd-status.err'));document.querySelector('[data-publish-copy]').click();await done;})()`);
    expect(await browser.evaluate("({copies:copied.length,status:document.querySelector('.shd-status').textContent,disabled:document.querySelector('[data-publish-copy]').disabled})")).toEqual({ copies: 2, status: expect.stringContaining(publicUrl), disabled: false });
  } finally { await browser.close(); server.stop(true); }
}, 15000);

test("non-publishers cannot see the publishing tab or share-tab publishing action", async () => {
  const browser = new Bun.WebView();
  try {
    await browser.navigate("about:blank");
    await browser.evaluate(`(() => {
      window.fetch = async url => ({ok:true,json:async()=>url === '/api/profile' ? {} : {role:'read'}});
      ${source}
    })()`);
    for (const role of ["read", "comment", "edit"]) {
      await browser.evaluate(`(async()=>{
        window.fetch = async url => ({ok:true,json:async()=>url === '/api/profile' ? {} : {role:${JSON.stringify(role)}}});
        const ready = new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{observer.disconnect();reject(Error('role timeout'));},3000);
          const observer=new MutationObserver(()=>{if(document.querySelector('[data-copy-page]')){clearTimeout(timer);observer.disconnect();resolve();}});
          observer.observe(document.body,{subtree:true,childList:true});
        });
        AcardShare.open('page'); await ready;
      })()`);
      expect(await browser.evaluate("document.querySelector('[data-publish-copy]') === null && document.querySelector('[data-tab=publish]') === null")).toBe(true);
    }
  } finally { await browser.close(); }
}, 15000);
