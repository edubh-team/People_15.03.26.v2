import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import type { ReportData } from '@/lib/reports/fetchReportData';

// Register a standard font (optional, but good for bold/italic)
// We'll just use Helvetica (built-in)

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#333',
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  headerLeft: {
    flexDirection: 'column',
  },
  logo: {
    width: 100,
    height: 40,
    objectFit: 'contain',
    marginBottom: 5,
  },
  companyName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4F46E5', // Indigo-600
  },
  headerRight: {
    textAlign: 'right',
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: 10,
    color: '#666',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#111',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 4,
  },
  // Key Cards Grid
  grid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  card: {
    flex: 1,
    backgroundColor: '#F9FAFB', // Slate-50
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  cardValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#111827',
  },
  // Table
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    padding: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    padding: 6,
  },
  tableRowStriped: {
    backgroundColor: '#F9FAFB',
  },
  col1: { width: '25%' }, // Client
  col2: { width: '25%' }, // University
  col3: { width: '25%' }, // Course
  col4: { width: '15%', textAlign: 'right' }, // Fee
  col5: { width: '10%', textAlign: 'right' }, // Date
  
  tableCellHeader: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#374151',
  },
  tableCell: {
    fontSize: 8,
    color: '#4B5563',
  },
  
  // Footer
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#9CA3AF',
  },
});

export default function EmployeeReportDocument({ data }: { data: ReportData }) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
             {/* Using a base64 placeholder for the logo to ensure PDF generation works without external dependencies */}
             {/* eslint-disable-next-line jsx-a11y/alt-text */}
             <Image 
               src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAoCAYAAAAIeF9DAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAkSURBVHgB7cEBDQAAAMKg909tDwcEAAAAAAAAAAAAAAAAcKwB9yQAxQ894gAAAABJRU5ErkJggg==" 
               style={styles.logo} 
             />
             <Text style={styles.companyName}>EduBH</Text>
             <Text style={styles.subtitle}>People & Performance</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>Monthly Performance Report</Text>
            <Text style={styles.subtitle}>{data.reportMonth}</Text>
            <Text style={{ fontSize: 8, marginTop: 4 }}>Generated: {data.generatedDate}</Text>
          </View>
        </View>

        {/* Employee Info Bar */}
        <View style={{ marginBottom: 20, backgroundColor: '#EEF2FF', padding: 10, borderRadius: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#3730A3' }}>
            {data.employeeName}
          </Text>
          <Text style={{ fontSize: 8, color: '#4338CA' }}>ID: {data.employeeId}</Text>
        </View>

        {/* Summary Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Executive Summary</Text>
          <View style={styles.grid}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Revenue</Text>
              <Text style={[styles.cardValue, { color: '#059669' }]}>
                {formatCurrency(data.sales.totalRevenue)}
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Attendance</Text>
              <Text style={styles.cardValue}>{data.attendance.attendancePercentage}%</Text>
              <Text style={{ fontSize: 8, color: '#666' }}>
                {data.attendance.presentDays}/{data.attendance.totalWorkingDays} Days
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Deals Closed</Text>
              <Text style={styles.cardValue}>{data.sales.totalSalesCount}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Calls Logged</Text>
              <Text style={styles.cardValue}>{data.calls.totalCalls}</Text>
            </View>
          </View>
        </View>

        {/* Funnel Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lead Funnel</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#F9FAFB', padding: 10, borderRadius: 4 }}>
             <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#6366F1' }}>{data.funnel.assigned}</Text>
                <Text style={{ fontSize: 8, color: '#6B7280' }}>Assigned</Text>
             </View>
             <Text style={{ fontSize: 18, color: '#E5E7EB' }}>→</Text>
             <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#F59E0B' }}>{data.funnel.contacted}</Text>
                <Text style={{ fontSize: 8, color: '#6B7280' }}>Contacted</Text>
             </View>
             <Text style={{ fontSize: 18, color: '#E5E7EB' }}>→</Text>
             <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#10B981' }}>{data.sales.totalSalesCount}</Text>
                <Text style={{ fontSize: 8, color: '#6B7280' }}>Converted</Text>
             </View>
          </View>
          <View style={{ marginTop: 8, flexDirection: 'row', gap: 4 }}>
             <Text style={{ fontSize: 8, color: '#EF4444' }}>Missed / Dropped: {data.funnel.missed}</Text>
             <Text style={{ fontSize: 8, color: '#EF4444' }}>• Late Logins: {data.attendance.lateLogins}</Text>
          </View>
        </View>

        {/* Sales Ledger Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Closed Deals Ledger</Text>
          <View style={styles.table}>
            {/* Header */}
            <View style={styles.tableHeader}>
              <View style={styles.col1}><Text style={styles.tableCellHeader}>Client Name</Text></View>
              <View style={styles.col2}><Text style={styles.tableCellHeader}>University</Text></View>
              <View style={styles.col3}><Text style={styles.tableCellHeader}>Course</Text></View>
              <View style={styles.col4}><Text style={styles.tableCellHeader}>Fee</Text></View>
              <View style={styles.col5}><Text style={styles.tableCellHeader}>Date</Text></View>
            </View>
            {/* Rows */}
            {data.sales.deals.length === 0 ? (
               <View style={[styles.tableRow, { justifyContent: 'center', padding: 10 }]}>
                 <Text style={{ fontSize: 8, fontStyle: 'italic', color: '#999' }}>No closed deals recorded for this period.</Text>
               </View>
            ) : (
               data.sales.deals.map((deal, i) => (
                <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowStriped : {}]}>
                  <View style={styles.col1}><Text style={styles.tableCell}>{deal.clientName}</Text></View>
                  <View style={styles.col2}><Text style={styles.tableCell}>{deal.university}</Text></View>
                  <View style={styles.col3}><Text style={styles.tableCell}>{deal.course}</Text></View>
                  <View style={styles.col4}><Text style={styles.tableCell}>{formatCurrency(deal.fee)}</Text></View>
                  <View style={styles.col5}><Text style={styles.tableCell}>{deal.date}</Text></View>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Confidential - Internal Use Only</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => (
            `${pageNumber} / ${totalPages}`
          )} fixed />
        </View>
      </Page>
    </Document>
  );
}
