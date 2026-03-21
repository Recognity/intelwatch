import { writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Export data to JSON format
 */
export function exportToJSON(data, outputPath = null) {
  const jsonStr = JSON.stringify(data, null, 2);
  
  if (outputPath) {
    writeFileSync(outputPath, jsonStr, 'utf8');
    return `Exported to ${outputPath}`;
  }
  
  // Print to console if no path specified
  console.log(jsonStr);
  return 'JSON output printed to console';
}

/**
 * Export data to CSV format
 * Supports both flat objects and nested structures
 */
export function exportToCSV(data, outputPath = null, options = {}) {
  if (!Array.isArray(data)) {
    throw new Error('CSV export requires an array of objects');
  }
  
  if (data.length === 0) {
    const emptyCSV = options.headers ? options.headers.join(',') + '\n' : '';
    if (outputPath) {
      writeFileSync(outputPath, emptyCSV, 'utf8');
      return `Empty CSV exported to ${outputPath}`;
    }
    console.log(emptyCSV);
    return 'Empty CSV output';
  }

  // Auto-detect headers from first object if not provided
  const headers = options.headers || Object.keys(data[0]);
  
  // CSV header row
  const csvRows = [headers.join(',')];
  
  // CSV data rows
  for (const item of data) {
    const row = headers.map(header => {
      let value = item[header];
      
      // Handle nested objects/arrays
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          value = value.join('; ');
        } else {
          value = JSON.stringify(value);
        }
      }
      
      // Escape CSV values
      value = String(value || '');
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = `"${value.replace(/"/g, '""')}"`;
      }
      
      return value;
    });
    
    csvRows.push(row.join(','));
  }
  
  const csvStr = csvRows.join('\n') + '\n';
  
  if (outputPath) {
    writeFileSync(outputPath, csvStr, 'utf8');
    return `CSV exported to ${outputPath}`;
  }
  
  console.log(csvStr);
  return 'CSV output printed to console';
}

/**
 * Flatten nested objects for CSV export
 * Example: { user: { name: 'John', age: 30 } } -> { 'user.name': 'John', 'user.age': 30 }
 */
export function flattenObject(obj, prefix = '', result = {}) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        flattenObject(obj[key], newKey, result);
      } else {
        result[newKey] = obj[key];
      }
    }
  }
  return result;
}

/**
 * Format data for export based on command type
 */
export function formatForExport(data, commandType) {
  switch (commandType) {
    case 'check':
      return formatCheckData(data);
    case 'digest':
      return formatDigestData(data);
    case 'report':
      return formatReportData(data);
    case 'profile':
      return formatProfileData(data);
    default:
      return data;
  }
}

function formatCheckData(data) {
  if (!Array.isArray(data)) return [data];
  
  return data.map(item => ({
    trackerId: item.id || item.trackerId,
    name: item.name,
    url: item.url,
    type: item.type,
    status: item.status || 'unknown',
    lastCheck: item.lastCheck,
    changes: Array.isArray(item.changes) ? item.changes.length : 0,
    techStack: Array.isArray(item.techStack) ? item.techStack.join('; ') : '',
    seoScore: item.seoScore || null,
    sentiment: item.sentiment || null
  }));
}

function formatDigestData(data) {
  if (!Array.isArray(data)) return [data];
  
  return data.map(item => flattenObject({
    tracker: {
      id: item.trackerId,
      name: item.name,
      type: item.type
    },
    changes: {
      total: item.changes?.length || 0,
      critical: item.changes?.filter(c => c.severity === 'critical').length || 0,
      major: item.changes?.filter(c => c.severity === 'major').length || 0,
      minor: item.changes?.filter(c => c.severity === 'minor').length || 0
    },
    summary: item.summary || ''
  }));
}

function formatReportData(data) {
  // For reports, export the raw data structure
  return Array.isArray(data) ? data : [data];
}

function formatProfileData(data) {
  if (!data) return [];
  
  const profile = Array.isArray(data) ? data[0] : data;
  
  const flattened = {
    // Company identity
    siren: profile.siren,
    name: profile.name || profile.identity?.name,
    legalForm: profile.identity?.formeJuridique,
    nafCode: profile.identity?.nafCode,
    nafLabel: profile.identity?.nafLabel,
    creationDate: profile.identity?.dateCreation,
    address: profile.identity?.adresse,
    
    // Financial data (latest year)
    revenue: profile.financialHistory?.[0]?.revenue,
    netIncome: profile.financialHistory?.[0]?.netIncome,
    employees: profile.financialHistory?.[0]?.employees,
    year: profile.financialHistory?.[0]?.year,
    
    // AI analysis
    executiveSummary: profile.executiveSummary,
    healthScore: profile.healthScore?.score,
    riskLevel: profile.riskAssessment?.overall,
    
    // Strengths (concatenated)
    strengths: profile.strengths?.map(s => s.text || s).join('; ') || '',
    
    // Weaknesses (concatenated)
    weaknesses: profile.weaknesses?.map(w => w.text || w).join('; ') || '',
    
    // Competitors (concatenated)
    competitors: profile.competitors?.map(c => c.name).join('; ') || '',
    
    // Group info
    subsidiariesCount: profile.subsidiaries?.length || 0,
    groupRevenue: profile.groupStructure?.consolidatedRevenue
  };
  
  return [flattened];
}