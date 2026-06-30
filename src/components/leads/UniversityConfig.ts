export type UniversityCourseConfig = {
  name: string;
  fee: number;
};

export type UniversityConfig = {
  registrationFee: number;
  courses: UniversityCourseConfig[];
};

export const UNIVERSITY_DATA: Record<string, UniversityConfig> = {
  "Jain University": {
    registrationFee: 0,
    courses: [
      // MBA Specializations
      { name: "MBA (Data Science and Analytics)", fee: 200000 },
      { name: "MBA (Digital Marketing and E-commerce)", fee: 200000 },
      { name: "MBA (Artificial Intelligence)", fee: 200000 },
      { name: "MBA (Banking and Finance)", fee: 220000 },
      { name: "MBA (International Finance - Accredited by ACCA, UK)", fee: 298000 },
      { name: "MBA (Finance and Marketing)", fee: 196000 },
      { name: "MBA (Human Resource Management and Finance)", fee: 196000 },
      { name: "MBA (Marketing and Human Resource Management)", fee: 196000 },
      { name: "MBA (Human Resource Management)", fee: 196000 },
      { name: "MBA (Finance and Business Analytics)", fee: 196000 },
      { name: "MBA (Finance)", fee: 196000 },
      { name: "MBA (Project Management)", fee: 196000 },
      { name: "MBA (Marketing)", fee: 196000 },
      { name: "MBA (Information Technology Management)", fee: 196000 },
      { name: "MBA (General Management)", fee: 196000 },
      { name: "MBA (Supply Chain, Production and Operations Management)", fee: 196000 },
      { name: "MBA (Business Intelligence & Analytics)", fee: 196000 },

      // MCA Specializations
      { name: "MCA (Computer Science & IT)", fee: 160000 },
      { name: "MCA (DevOps)", fee: 160000 },
      { name: "MCA (Cyber Security)", fee: 160000 },
      { name: "MCA (Data Analytics)", fee: 160000 },
      { name: "MCA (NLP & LLM Development)", fee: 160000 },
      { name: "MCA (Artificial Intelligence)", fee: 200000 },
      { name: "MCA (Cloud Computing)", fee: 200000 },
      { name: "MCA (Full Stack Development)", fee: 200000 },
      { name: "MCA (Data Science)", fee: 200000 },

      // MCOM Specializations
      { name: "MCOM (Professional Accounting and Finance)", fee: 45500 },
      { name: "MCOM (International Finance - Integrated with ACCA, UK)", fee: 181000 },
      { name: "MCOM (Accounting and Finance)", fee: 110000 },

      // MA Specializations
      { name: "MA (English)", fee: 90000 },
      { name: "MA (Public Policy)", fee: 90000 },
      { name: "MA (Economics)", fee: 90000 },
      { name: "MA (Jainology and Comparative Religion & Philosophy)", fee: 15000 },

      // BBA Specializations
      { name: "BBA (Finance)", fee: 150000 },
      { name: "BBA (Marketing)", fee: 150000 },
      { name: "BBA (Human Resource Management)", fee: 150000 },
      { name: "BBA (Digital Marketing)", fee: 175000 },
      { name: "BBA (Data Science and Analytics)", fee: 175000 },

      // BCOM Specializations
      { name: "BCOM (Accounting and Finance)", fee: 120000 },
      { name: "BCOM (International Finance & Accounting - Accredited by ACCA, UK)", fee: 228000 },

      // BCA Specializations
      { name: "BCA (Computer Science and IT)", fee: 135000 },
      { name: "BCA (Data Science and Analytics)", fee: 165000 },
      { name: "BCA (Cyber Security)", fee: 165000 },
      { name: "BCA (Artificial Intelligence)", fee: 165000 },
      { name: "BCA (Cloud Computing)", fee: 165000 },
    ]
  },
  "Sharda University Online": {
    registrationFee: 0,
    courses: [
      // MBA Specializations
      { name: "MBA (Finance)", fee: 140000 },
      { name: "MBA (Marketing)", fee: 140000 },
      { name: "MBA (Human Resource Management)", fee: 140000 },
      { name: "MBA (Healthcare and Hospital Administration)", fee: 140000 },
      { name: "MBA (Data Science and Analytics)", fee: 196000 },

      // MCA Specializations
      { name: "MCA (Data Science)", fee: 120000 },
      { name: "MCA (Computer Science and IT)", fee: 120000 },

      // Undergraduate
      { name: "BA (Hons) (Political Science)", fee: 105000 },
      { name: "BBA (General)", fee: 120000 },
      { name: "BCA (IT Industry)", fee: 120000 },

      // PGP
      { name: "PGP (Banking and Financial Services)", fee: 30000 },
    ]
  },
  "Manipal University": {
    registrationFee: 0,
    courses: [
      // Postgraduate
      { name: "Master of Business Administration (MBA)", fee: 175000 },
      { name: "Master of Computer Application (MCA)", fee: 158000 },
      { name: "Master of Commerce (MCom)", fee: 108000 },
      { name: "MA (Economics)", fee: 80000 },
      { name: "MA (Journalism and Mass Communication)", fee: 80000 },
      { name: "MA (English)", fee: 75000 },
      { name: "MA (Political Science)", fee: 75000 },
      { name: "MA (Sociology)", fee: 75000 },

      // Undergraduate
      { name: "Bachelor of Business Administration (BBA)", fee: 135000 },
      { name: "Bachelor of Computer Application (BCA)", fee: 135000 },
      { name: "Bachelor of Commerce (BCom)", fee: 99000 },
    ]
  },
  "Arka Jain University": {
    registrationFee: 2500,
    courses: [
      { name: "BBA", fee: 104000 },
      { name: "BCA", fee: 104000 },
      { name: "MBA", fee: 100000 },
      { name: "MCA", fee: 100000 },
    ],
  },
  "LPU Online": {
    registrationFee: 600,
    courses: [
      { name: "OL24AF - Master of Science (Economics) [4 Sem]", fee: 80000 },
      { name: "OL4427 - Master of Arts (English) [4 Sem]", fee: 80000 },
      { name: "OL442B - Master of Arts (History) [4 Sem]", fee: 80000 },
      { name: "OL24A9 - Master of Science (Mathematics) [4 Sem]", fee: 80000 },
      { name: "OL442D - Master of Arts (Political Science) [4 Sem]", fee: 80000 },
      { name: "OL442C - Master of Arts (Sociology) [4 Sem]", fee: 80000 },
      { name: "OL3422 - Master of Commerce [4 Sem]", fee: 100000 },
      { name: "OL1624 - Master of Computer Applications [4 Sem]", fee: 148000 },
      { name: "OL3521 - Master of Business Administration [4 Sem]", fee: 200000 },
      { name: "OL4120 - Bachelor of Arts [6 Sem]", fee: 120000 },
      { name: "OL1124 - Bachelor of Computer Applications [6 Sem]", fee: 150000 },
      { name: "OL3121 - Bachelor of Business Administration [6 Sem]", fee: 150000 },
      { name: "OL3K2H - Diploma in Business Administration [2 Sem]", fee: 50000 },
      { name: "OL1K24 - Diploma in Computer Applications [2 Sem]", fee: 50000 },
    ],
  },
};

export type UniversityName = keyof typeof UNIVERSITY_DATA;
