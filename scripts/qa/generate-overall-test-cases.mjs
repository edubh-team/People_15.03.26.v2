import * as XLSX from "@e965/xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const OUT = resolve("docs", "QA_Overall_Test_Cases_2026_Q2.xlsx");
const ROLES = ["BDA_TRAINEE","BDA","BDM_TRAINING","TEAM_LEAD","MANAGER","SENIOR_MANAGER","HR","FINANCER","ADMIN","SUPER_ADMIN"];
const rows = [];
let n = 1;

const steps = (...arr) => arr.map((s,i)=>`${i+1}. ${s}`).join("\n");
const add = ({suite,module,feature,title,role,priority="P1",type="Functional",pre="Role account is active.",expected,testData="",auto="Yes",owner="QA"}) => {
  rows.push({
    "Test Case ID": `TC-${String(n++).padStart(4,"0")}`,
    Suite: suite, Module: module, Feature: feature, "Scenario Title": title, Role: role,
    Priority: priority, Type: type, Preconditions: pre,
    Steps: steps("Login with target role.","Execute scenario action.","Verify UI + DB/audit result."),
    "Expected Result": expected, "Test Data": testData, "Automation Candidate": auto,
    Status: "Not Run", Owner: owner, Evidence: "", Notes: ""
  });
};

// 1) Route access matrix
const routePolicies = [
  {r:"/my-day",a:ROLES,p:"P0"},
  {r:"/crm/leads",a:["BDA_TRAINEE","BDA","BDM_TRAINING","TEAM_LEAD","MANAGER","SENIOR_MANAGER","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/team",a:["TEAM_LEAD","MANAGER","SENIOR_MANAGER","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/team/directory",a:["TEAM_LEAD","MANAGER","SENIOR_MANAGER","HR","ADMIN","SUPER_ADMIN"],p:"P1"},
  {r:"/hr",a:["HR","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/hr/leaves",a:["TEAM_LEAD","MANAGER","SENIOR_MANAGER","HR","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/payroll",a:["HR","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/finance",a:["FINANCER","SUPER_ADMIN"],p:"P0"},
  {r:"/reports",a:["TEAM_LEAD","MANAGER","SENIOR_MANAGER","HR","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/super-admin/personnel",a:["HR","ADMIN","SUPER_ADMIN"],p:"P0"},
  {r:"/super-admin/mission-control",a:["SUPER_ADMIN"],p:"P0"},
  {r:"/admin/settings",a:["ADMIN","SUPER_ADMIN"],p:"P1"},
  {r:"/chat",a:ROLES,p:"P1"},
];
routePolicies.forEach(({r,a,p})=>ROLES.forEach((role)=>add({
  suite:"Access Control", module:"Authorization", feature:"Route Guard",
  title:`Access ${r} as ${role}`, role, priority:p, type:"Security",
  expected:a.includes(role)?"Access granted as per role policy.":"Access denied; no data leak."
})));

// 2) Authentication/session
[
  ["Valid login", "All", "P0", "Login succeeds and redirects to role home."],
  ["Invalid password", "All", "P0", "Login blocked with safe error."],
  ["Session cookie set", "All", "P0", "Secure session cookie present after login."],
  ["Logout clears session", "All", "P0", "Protected routes redirect after logout."],
  ["Onboarding redirect for incomplete profile", "BDA/BDA_TRAINEE/BDM_TRAINING", "P1", "User forced to onboarding until completed."],
  ["Inactive account blocked", "Inactive user", "P0", "Inactive/terminated users cannot operate protected app."],
].forEach(([title,role,priority,expected])=>add({suite:"Authentication",module:"Auth",feature:"Session",title,role,priority,expected}));

// 3) CRM functional matrix
const crmScenarios = {
  "Lead Create": ["Create lead with mandatory fields","Validation on missing mandatory fields","Punch new sale from lead"],
  "Lead Import": ["Template includes leadLocation + preferredLanguage","Import with tags + batch id","Import duplicate rows flagged with reason"],
  "Queue": ["Compact one-line rows","Card/Queue mode switch keeps counts","Queue supports 500+ records with pagination"],
  "Lead Detail": ["Top section shows activities + stage outcome + tasks","BDA and above can use detail tabs","Edit leadLocation + preferredLanguage"],
  "Assignment": ["BDA cannot assign/reassign","Manager+ can reassign with reason","Pullback -> reassign updates custody timeline"],
  "Smart Views": ["New Leads tab live count","Due Today tab live count","No Activity 24h tab live count","Payment Follow Up tab live count","Callbacks tab live count","My Closures tab live count"],
  "Smart Filters": ["Filter by status","Filter by owner","Filter by source/campaign","Filter by tag/batch","Filter by activity/date range","Filter by location/language"],
  "Bulk Actions": ["Explicit checkbox selection","Count-based auto selection","Preview diff before apply","Execution logs include failures","Rollback-safe rerun"],
  "Duplicates": ["Duplicate queue loads candidates","Merge preview conflict handling","Survivor rule preset","Merge audit trail immutable"],
};
Object.entries(crmScenarios).forEach(([feature,scenarios])=>scenarios.forEach((title)=>add({
  suite:"CRM", module:"CRM", feature, title,
  role:feature==="Assignment"?"Role-scoped":"BDA and above",
  priority:["Assignment","Lead Create","Bulk Actions"].includes(feature)?"P0":"P1",
  expected:"Feature works as designed with scope checks and audit persistence.",
  testData:"Use seeded leads across new/due/overdue/stale/payment/closed states."
})));

// 4) Team/manager operations
[
  "Bulk assign by source/campaign/status",
  "Bulk assign by stale/payment bucket",
  "Open in CRM from bulk execution log",
  "Manager intervention in <=3 clicks",
  "Team heatmap drilldown to member list",
].forEach((title)=>add({suite:"Team Ops",module:"Team",feature:"Manager Console",title,role:"Manager and above",priority:"P1",expected:"Manager operations execute correctly with hierarchy scope."}));

// 5) Attendance + leave + lifecycle
const peopleScenarios = {
  "Attendance": [
    "Check-in/check-out recorded with timestamps",
    "Manager+ mark absent override requires reason",
    "HR reviews attendance corrections",
    "Override log immutable and visible to payroll",
    "Saturday optional + Sunday mandatory-off policy applied"
  ],
  "Leaves": [
    "BDA leave request shows Applied (Pending)",
    "Request routed to HR then reporting manager",
    "Approval/rejection updates status and reason",
    "Monthly leave cap (2 weeks) impacts payroll deduction"
  ],
  "Personnel Studio": [
    "Admin applies permanent reporting change",
    "Admin applies temporary reporting with reason + until",
    "HR applies permanent reporting change",
    "HR applies temporary reporting with reason + until",
    "Role change for non-protected users",
    "SUPER_ADMIN/ADMIN role remains protected",
    "Deactivate transfers active leads to manager",
    "Inactive till date reactivates after window",
    "Terminate disables operational access"
  ]
};
Object.entries(peopleScenarios).forEach(([feature,scenarios])=>scenarios.forEach((title)=>add({
  suite:"People Ops", module:"HR/People", feature, title,
  role:feature==="Attendance"?"Employee/Manager/HR":"BDA/Manager/HR/Admin",
  priority:["Attendance","Leaves"].includes(feature)?"P0":"P1",
  expected:"Workflow state transitions and audits are correct across HR + manager views."
})));

// 6) Training/targets/PIP/counselling
[
  ["Trainee qualifies to BDA after 1 sale in 15 days","P0"],
  ["HR and Senior Manager+ can qualify trainee","P0"],
  ["Trainee incentive is not calculated","P0"],
  ["14-day cycle counters update from sales","P0"],
  ["Rolling 3-cycle compliance computes correctly","P0"],
  ["PIP auto-creates on missed 3-cycle target","P0"],
  ["PIP pass/fail transitions", "P0"],
  ["Counselling target 15/bi-weekly progress", "P1"],
  ["Counselling payout = approved count x 10", "P1"],
  ["Counselling payout gated by 3 sales in 3 bi-weekly", "P0"],
].forEach(([title,priority])=>add({suite:"Performance Engine",module:"Training/Targets",feature:"Targets-PIP",title,role:"BDA/Manager/HR/Finance",priority,expected:"Calculations and transitions are accurate and role-scoped."}));

// 7) Finance
[
  "Finance dashboard role isolation",
  "Maker-checker approval flow",
  "Finance audit trail immutable",
  "Income categories include University/Family fund/Investors fund/Donation/Loan",
  "Expense categories include FREELANCER/EMI/MARKETING/OFFICE EXPENSES/Traveling/Advance salary/Bonus",
  "Finance export payload includes payroll + counselling fields",
  "BDA cannot access finance controls",
].forEach((title)=>add({suite:"Finance",module:"Finance",feature:"Transactions/Approvals",title,role:"Finance/HR/Admin",priority:"P0",expected:"Finance controls are complete, isolated, and auditable."}));

// 8) Reporting + dashboards
[
  "Role-scoped KPI templates",
  "Saved template scope differs by role",
  "Drilldown to lead list keeps scope",
  "Scheduled export create/pause/resume/delete",
  "Dashboard cards click to graph/table details",
  "Exception alerts for stale/overdue/transfer backlog",
].forEach((title)=>add({suite:"Reporting",module:"Reports/Dashboards",feature:"Hierarchy Reports",title,role:"Role-specific",priority:"P1",expected:"Report output and drilldowns are scope-correct."}));

// 9) Messaging + alerts + audit
[
  "Cross-team chat send/receive",
  "Non-participant cannot read chat channel",
  "SLA breach alert generation",
  "Cycle-close/target-miss/PIP/inactivity alerts",
  "Lead transfer/attendance override/finance approval audit entries",
].forEach((title)=>add({suite:"Collaboration",module:"Chat/Alerts/Audit",feature:"Messaging & Audit",title,role:"Role-specific",priority:"P1",type:title.includes("cannot")?"Security":"Functional",expected:"Messaging and alerts are reliable with immutable audit logs."}));

// 10) API + Firestore rules
const apis=["/api/session/set","/api/session/clear","/api/users/create","/api/finance/transaction","/api/finance/approvals","/api/finance/accounts","/api/team/unassigned-leads","/api/team/pipeline-stats","/api/cron/auto-checkout","/api/cron/crm-automation","/api/email/send-onboarding","/api/setup/promote"];
apis.forEach((ep)=>{
  add({suite:"API",module:"Backend API",feature:ep,title:`${ep} rejects unauthenticated`,role:"Unauthenticated",priority:"P0",type:"Security",expected:"401/403 with no sensitive data."});
  add({suite:"API",module:"Backend API",feature:ep,title:`${ep} validates bad payload`,role:"Authorized role",priority:"P1",type:"Negative",expected:"Validation error and no partial write."});
  add({suite:"API",module:"Backend API",feature:ep,title:`${ep} valid request success`,role:"Authorized role",priority:"P1",expected:"Success response + expected write/audit."});
});
["users","leads","attendance","leaveRequests","payroll","reports","channels/messages","activities","finance approvals","crm transfer logs"].forEach((c)=>{
  add({suite:"Security Rules",module:"Firestore Rules",feature:c,title:`${c} read scope rule`,role:"Role matrix",priority:"P0",type:"Security",expected:"Only in-scope reads allowed."});
  add({suite:"Security Rules",module:"Firestore Rules",feature:c,title:`${c} write scope rule`,role:"Role matrix",priority:"P0",type:"Security",expected:"Only authorized writes allowed."});
});

// 11) Non-functional
[
  ["Lead queue <2s for 500 rows","Performance","P1"],
  ["Bulk action 500 leads completes with logs","Performance","P1"],
  ["Global search <1s first result","Performance","P1"],
  ["No hydration mismatch warnings","Regression","P1"],
  ["No hook-order warnings in lead panel","Regression","P0"],
  ["Desktop alignment no overlap","UX","P1"],
  ["Mobile alignment no overlap","UX","P1"],
  ["Keyboard accessibility and focus states","Accessibility","P2"],
  ["Chrome/Edge/Firefox compatibility","Compatibility","P1"],
  ["Rollout + rollback dry run","Release","P0"],
].forEach(([title,type,priority])=>add({suite:"Non-Functional",module:"Platform",feature:"Quality",title,role:"N/A",type,priority,expected:"Quality gate passes threshold.",auto:type==="UX"||type==="Accessibility"?"No":"Yes"}));

// 12) Role-wise UAT pack
const uat={
  BDA:["My Day queue execution","Call log + follow-up","Create/import lead","Punch new sale","Leave request pending view"],
  MANAGER:["Pullback + reassign","Bulk assign explicit + count","Mark absent override","At-risk/PIP dashboard","Final leave approval"],
  HR:["Attendance correction review","Leave workflow","Personnel temporary/permanent edits","Trainee qualification","Payroll-ready validation"],
  FINANCER:["Transaction entry","Maker-checker approvals","Finance dashboard drilldowns","Export payload","Access isolation check"],
  LEADERSHIP:["Role-scoped report","KPI drilldown","Exception alerts","Hierarchy scope validation","Release sign-off"]
};
Object.entries(uat).forEach(([role,items])=>items.forEach((title,i)=>add({suite:"Role UAT",module:"UAT Pack",feature:`${role} UAT`,title:`${role}: ${title}`,role,priority:i<3?"P0":"P1",type:"UAT",expected:"Scenario passes with correct role behavior.",auto:"No",owner:"Role QA Owner"})));

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);
ws["!cols"]=[{wch:12},{wch:16},{wch:18},{wch:24},{wch:52},{wch:20},{wch:8},{wch:14},{wch:32},{wch:54},{wch:56},{wch:32},{wch:14},{wch:10},{wch:16},{wch:18},{wch:20}];
XLSX.utils.book_append_sheet(wb, ws, "Master_Test_Cases");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter(r=>r.Suite==="Access Control")), "Role_Access_Matrix");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter(r=>!["Access Control","API","Security Rules","Non-Functional"].includes(r.Suite))), "Functional_Regression");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter(r=>r.Suite==="API"||r.Suite==="Security Rules")), "API_and_Rules");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.filter(r=>r.Suite==="Non-Functional")), "Performance_UX_A11y");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(r=>({"Test Case ID":r["Test Case ID"],"Scenario Title":r["Scenario Title"],Role:r.Role,Priority:r.Priority,Owner:r.Owner,Status:"Not Run","Execution Date":"","Tester Name":"","Defect ID":"",Evidence:"",Comments:""}))), "Execution_Tracker");

const count = (key) => rows.reduce((m,r)=>{m.set(r[key],(m.get(r[key])||0)+1);return m;},new Map());
const suiteRows = Array.from(count("Suite").entries()).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
const priRows = Array.from(count("Priority").entries()).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
const typeRows = Array.from(count("Type").entries()).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
const summary = XLSX.utils.aoa_to_sheet([
  ["Workbook","QA Overall Test Cases 2026 Q2"],
  ["Generated On", new Date().toISOString()],
  ["Total Test Cases", rows.length],
  [""],["Suite","Count"],...suiteRows,[""],["Priority","Count"],...priRows,[""],["Type","Count"],...typeRows,
  [""],["Execution Guidance","Run P0 first, then P1, then P2. Capture evidence + defect IDs in tracker."]
]);
summary["!cols"]=[{wch:28},{wch:95}];
XLSX.utils.book_append_sheet(wb, summary, "Summary");

mkdirSync(dirname(OUT), { recursive: true });
const workbookBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
writeFileSync(OUT, workbookBuffer);
console.log(`Generated ${rows.length} test cases at ${OUT}`);
