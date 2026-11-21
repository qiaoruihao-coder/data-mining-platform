export function ownerOf(path) {
 const p=path.replaceAll("\\","/");
 if(/^docs\/requests\/[ABCD]-/.test(p)) return p.split("/").at(-1)[0];
 if(/^docs\/tasks\/[ABCD]\.md$/.test(p)) return p.split("/").at(-1)[0];
 if(/^tests\/[ABCD][-.]/.test(p)) return p.split("/").at(-1)[0];
 if(/^src\/app\/owner\/(matches|quotes)(\/|$)/.test(p)) return "B";
 if(/^src\/app\/api\/(match|quote)(\/|$)/.test(p)) return "B";
 if(/^src\/lib\/(match|quote-engine)(\/|\.)/.test(p)) return "B";
 if(/^src\/components\/(ProviderCard|QuoteTable)(\/|\.)/.test(p)) return "B";
 if(/^src\/app\/owner(\/|$)/.test(p)) return "A";
 if(/^src\/components\/(ChatWindow|DemandCard|GanttChart)(\/|\.)/.test(p)) return "A";
 if(/^src\/app\/(provider|admin)(\/|$)/.test(p)) return "C";
 if(/^src\/components\/StatusBadge(\/|\.)/.test(p)) return "C";
 if(/^src\/features\/[abc](\/|$)/.test(p)) return p.split("/")[2].toUpperCase();
 return "D";
}
