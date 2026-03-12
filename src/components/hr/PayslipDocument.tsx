
import React from 'react';
import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import { Payroll } from '@/lib/types/hr';

// Create styles
const styles = StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#FFFFFF',
    padding: 30,
    fontFamily: 'Helvetica'
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  companyInfo: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'right'
  },
  section: {
    margin: 10,
    padding: 10,
    flexGrow: 1
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 2
  },
  label: {
    fontSize: 12,
    color: '#64748B'
  },
  value: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopColor: '#0F172A'
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  totalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0F172A'
  },
  footer: {
    marginTop: 30,
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'center'
  }
});

interface PayslipProps {
  payroll: Payroll;
}

const PayslipDocument: React.FC<PayslipProps> = ({ payroll }) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View>
            <Text style={styles.title}>Payslip</Text>
            <Text style={{ fontSize: 12, color: '#64748B' }}>{payroll.month}</Text>
        </View>
        <View style={styles.companyInfo}>
            <Text>PayLink4U</Text>
            <Text>HR Department</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: '#334155' }}>Employee Details</Text>
        <View style={styles.row}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{payroll.userDisplayName || 'Employee'}</Text>
        </View>
        <View style={styles.row}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{payroll.userEmail || '-'}</Text>
        </View>
        <View style={styles.row}>
            <Text style={styles.label}>Payroll ID</Text>
            <Text style={styles.value}>{payroll.id}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: '#334155' }}>Attendance</Text>
        <View style={styles.row}>
            <Text style={styles.label}>Days Present</Text>
            <Text style={styles.value}>{payroll.daysPresent}</Text>
        </View>
        <View style={styles.row}>
            <Text style={styles.label}>Days Absent</Text>
            <Text style={styles.value}>{payroll.daysAbsent}</Text>
        </View>
        <View style={styles.row}>
            <Text style={styles.label}>Lates</Text>
            <Text style={styles.value}>{payroll.lates}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 10, color: '#334155' }}>Earnings & Deductions</Text>
        <View style={styles.row}>
            <Text style={styles.label}>Base Salary</Text>
            <Text style={styles.value}>₹ {payroll.baseSalary.toLocaleString()}</Text>
        </View>
        <View style={styles.row}>
            <Text style={styles.label}>Incentives</Text>
            <Text style={styles.value}>₹ {payroll.incentives.toLocaleString()}</Text>
        </View>
        <View style={styles.row}>
            <Text style={styles.label}>Deductions</Text>
            <Text style={[styles.value, { color: '#EF4444' }]}>- ₹ {payroll.deductions.toLocaleString()}</Text>
        </View>

        <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Net Pay</Text>
            <Text style={styles.totalValue}>₹ {payroll.netSalary.toLocaleString()}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text>This is a computer-generated document and does not require a signature.</Text>
        <Text>Generated on {new Date().toLocaleDateString()}</Text>
      </View>
    </Page>
  </Document>
);

export default PayslipDocument;
