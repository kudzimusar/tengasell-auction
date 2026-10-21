// Parse the MSCS 1.0 canonical registry (609 controls) from extracted PDF text
import { readFileSync, writeFileSync } from "fs";

const DOMAINS = ["STR","EXP","IAM","ORG","MKT","COM","CMS","SRC","MSG","CTL","SUP","TNS","FIN","CORP","GRW","PRT","DAT","BI","API","DEV","MCP","INT","SEC","PRV","LEG","GOV","ACC","I18N","INF","ENG","OPS","INC","BCP","REL","DOC","EXE","RSK"];
const idRe = new RegExp(`^(${DOMAINS.join("|")})-(\\d{3})$`);

const lines = readFileSync("/home/z/my-project/agent-ctx/mscs-1.0.txt", "utf8").split("\n").map(l => l.trim()).filter(l => l.length > 0);

const controls = [];
let currentDomain = null;
let domainDesc = "";

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(idRe);
  if (m) {
    const id = line;
    // next 4 non-empty lines: name, floor, criticality, evidence
    const name = lines[i+1];
    const floor = lines[i+2];
    const crit = lines[i+3];
    const evid = lines[i+4];
    if (name && /^M[1-4]$/.test(floor) && /^C[0-4]$/.test(crit) && /^E/.test(evid)) {
      controls.push({ id, domain: m[1], name, floor, criticality: crit, evidence: evid, domainName: currentDomain });
    } else {
      console.error("PARSE FAIL at", id, JSON.stringify([name, floor, crit, evid]));
    }
  }
  // domain header: "STR DOMAIN"
  const dm = line.match(/^([A-Z]{3,4}) DOMAIN$/);
  if (dm && DOMAINS.includes(dm[1])) {
    currentDomain = dm[1];
    domainDesc = lines[i+1] || "";
  }
}

console.log("Total controls parsed:", controls.length);
// Group by domain
const byDomain = {};
for (const c of controls) {
  byDomain[c.domain] = byDomain[c.domain] || [];
  byDomain[c.domain].push(c.id);
}
const domainSummary = Object.entries(byDomain).map(([d, ids]) => `${d}: ${ids.length}`).join(" | ");
console.log(domainSummary);
// duplicates check
const ids = controls.map(c => c.id);
const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
console.log("Duplicates:", dupes.length ? dupes : "none");

writeFileSync("/home/z/my-project/agent-ctx/mscs-registry.json", JSON.stringify({ parsed: new Date().toISOString(), total: controls.length, controls }, null, 1));
console.log("Wrote /home/z/my-project/agent-ctx/mscs-registry.json");
