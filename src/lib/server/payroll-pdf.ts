import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { buildPayslipPreviewModel, formatInrNumber } from "@/lib/payroll/payslip";
import type { PayrollDetailsResponse } from "@/lib/types/payroll";

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAGE = {
  width: 841.89,
  height: 595.28,
  margin: 36,
};

const COLORS = {
  ink: "#0F172A",
  muted: "#475569",
  border: "#CBD5E1",
  line: "#E2E8F0",
  soft: "#F8FAFC",
  accent: "#2563EB",
  accentSoft: "#DBEAFE",
};

function drawLogoMark(doc: PdfDoc, x: number, y: number) {
  doc.save();
  doc.roundedRect(x, y, 42, 42, 12).fill(COLORS.ink);
  doc.roundedRect(x + 8, y + 8, 24, 26, 8).fill(COLORS.accent);
  doc.roundedRect(x + 14, y + 14, 18, 12, 6).fill(COLORS.accentSoft);
  doc.restore();
}

function resolveLogoAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  const assetPath = path.join(process.cwd(), "public", normalized.replace(/^public[\\/]/, ""));
  return existsSync(assetPath) ? assetPath : null;
}

function drawDetailCell(
  doc: PdfDoc,
  input: {
    x: number;
    y: number;
    width: number;
    label: string;
    value: string;
  },
) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted).text(input.label, input.x, input.y, {
    width: input.width,
  });
  doc.font("Helvetica").fontSize(11).fillColor(COLORS.ink).text(input.value, input.x, input.y + 14, {
    width: input.width,
  });
}

function drawPayslipTable(
  doc: PdfDoc,
  input: ReturnType<typeof buildPayslipPreviewModel>,
  x: number,
  y: number,
  width: number,
) {
  const rowHeight = 28;
  const headerHeight = 30;
  const totalHeight = 30;
  const tableHeight = headerHeight + rowHeight * input.earningsRows.length + totalHeight;
  const colWidths = [width * 0.36, width * 0.14, width * 0.36, width * 0.14];
  const colStarts = [
    x,
    x + colWidths[0],
    x + colWidths[0] + colWidths[1],
    x + colWidths[0] + colWidths[1] + colWidths[2],
  ];

  doc.roundedRect(x, y, width, tableHeight, 14).fillAndStroke("#FFFFFF", COLORS.border);
  doc.rect(x, y, width, headerHeight).fillAndStroke(COLORS.soft, COLORS.border);

  for (let index = 1; index < colStarts.length; index += 1) {
    doc.moveTo(colStarts[index], y).lineTo(colStarts[index], y + tableHeight).strokeColor(COLORS.border).stroke();
  }

  const headers = ["Earnings", "Amount(in INR)", "Deductions", "Amount(in INR)"];
  headers.forEach((header, index) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text(
      header,
      colStarts[index] + 10,
      y + 10,
      {
        width: colWidths[index] - 20,
        align: index % 2 === 1 ? "right" : "left",
      },
    );
  });

  input.earningsRows.forEach((earning, index) => {
    const rowY = y + headerHeight + index * rowHeight;
    doc.moveTo(x, rowY).lineTo(x + width, rowY).strokeColor(COLORS.line).stroke();

    const deduction = input.deductionRows[index];
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(earning.label, colStarts[0] + 10, rowY + 9, {
      width: colWidths[0] - 20,
    });
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(formatInrNumber(earning.amount), colStarts[1] + 10, rowY + 9, {
      width: colWidths[1] - 20,
      align: "right",
    });
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(deduction.label, colStarts[2] + 10, rowY + 9, {
      width: colWidths[2] - 20,
    });
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(formatInrNumber(deduction.amount), colStarts[3] + 10, rowY + 9, {
      width: colWidths[3] - 20,
      align: "right",
    });
  });

  const totalY = y + headerHeight + rowHeight * input.earningsRows.length;
  doc.moveTo(x, totalY).lineTo(x + width, totalY).strokeColor(COLORS.border).stroke();
  doc.rect(x, totalY, width, totalHeight).fillAndStroke(COLORS.soft, COLORS.border);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text("Total", colStarts[0] + 10, totalY + 9, {
    width: colWidths[0] - 20,
  });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text(formatInrNumber(input.totalEarnings), colStarts[1] + 10, totalY + 9, {
    width: colWidths[1] - 20,
    align: "right",
  });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text("Total", colStarts[2] + 10, totalY + 9, {
    width: colWidths[2] - 20,
  });
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text(formatInrNumber(input.totalDeductions), colStarts[3] + 10, totalY + 9, {
    width: colWidths[3] - 20,
    align: "right",
  });
}

export async function generatePayrollPdf(details: PayrollDetailsResponse) {
  const payslip = buildPayslipPreviewModel({
    employee: {
      name: details.employee.name,
      employeeId: details.employee.employeeId,
      designation: details.employee.designation,
      department: details.employee.department,
    },
    payroll: details.payroll,
  });

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PAGE.margin,
  });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const contentWidth = PAGE.width - PAGE.margin * 2;
  const infoBlockWidth = (contentWidth - 32) / 2;
  const logoAssetPath = resolveLogoAssetPath(payslip.logoPath);

  if (logoAssetPath) {
    doc.image(logoAssetPath, PAGE.margin, 24, {
      fit: [330, 74],
    });
  } else {
    drawLogoMark(doc, PAGE.margin, 30);
    doc.font("Helvetica-Bold").fontSize(22).fillColor(COLORS.ink).text(payslip.companyName, PAGE.margin + 58, 33);
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(payslip.tagline, PAGE.margin + 58, 59);
  }

  doc.font("Helvetica").fontSize(12).fillColor(COLORS.ink).text(payslip.netPaySummaryLine, PAGE.margin + 320, 40, {
    width: 450,
    align: "right",
  });

  doc.moveTo(PAGE.margin, 90).lineTo(PAGE.margin + contentWidth, 90).strokeColor(COLORS.border).stroke();

  doc.roundedRect(PAGE.margin, 108, contentWidth, 102, 14).fillAndStroke("#FFFFFF", COLORS.border);
  drawDetailCell(doc, {
    x: PAGE.margin + 16,
    y: 126,
    width: infoBlockWidth / 2,
    label: "Employee Name:",
    value: payslip.employeeName,
  });
  drawDetailCell(doc, {
    x: PAGE.margin + 16,
    y: 166,
    width: infoBlockWidth / 2,
    label: "Employee ID:",
    value: payslip.employeeId,
  });
  drawDetailCell(doc, {
    x: PAGE.margin + contentWidth / 2 + 12,
    y: 126,
    width: infoBlockWidth,
    label: "Payment Period:",
    value: payslip.paymentPeriodLabel,
  });
  drawDetailCell(doc, {
    x: PAGE.margin + contentWidth / 2 + 12,
    y: 166,
    width: infoBlockWidth,
    label: "Payment Date:",
    value: payslip.paymentDateLabel,
  });
  drawDetailCell(doc, {
    x: PAGE.margin + 190,
    y: 126,
    width: infoBlockWidth / 2 - 10,
    label: "Designation:",
    value: payslip.designation,
  });
  drawDetailCell(doc, {
    x: PAGE.margin + 190,
    y: 166,
    width: infoBlockWidth / 2 - 10,
    label: "Department:",
    value: payslip.department,
  });

  drawPayslipTable(doc, payslip, PAGE.margin, 230, contentWidth);

  doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text(
    "This is a computer-generated slip no need of any signature",
    PAGE.margin,
    PAGE.height - 46,
    {
      width: contentWidth,
      align: "center",
    },
  );

  doc.end();
  return done;
}
