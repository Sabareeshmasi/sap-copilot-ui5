const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

class ReportGenerator {
  constructor() {
    this.reportsDir = path.join(__dirname, '../reports');
    this.ensureReportsDirectory();
  }

  /**
   * Ensure reports directory exists
   */
  ensureReportsDirectory() {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Generate PDF report
   */
  async generatePDFReport(data, reportType, title) {
    try {
      console.log(`📄 Generating PDF report: ${title}`);
      
      const fileName = `${reportType}_${Date.now()}.pdf`;
      const filePath = path.join(this.reportsDir, fileName);
      
      const doc = new PDFDocument();
      doc.pipe(fs.createWriteStream(filePath));
      
      // Header
      doc.fontSize(20).text(title, 50, 50);
      doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`, 50, 80);
      doc.moveDown();
      
      // Content based on report type
      switch (reportType) {
        case 'products':
          this.addProductsTableToPDF(doc, data);
          break;
        case 'inventory':
          this.addInventoryTableToPDF(doc, data);
          break;
        case 'customers':
          this.addCustomersTableToPDF(doc, data);
          break;
        default:
          this.addGenericTableToPDF(doc, data);
      }
      
      doc.end();
      
      console.log(`✅ PDF report generated: ${fileName}`);
      return {
        success: true,
        fileName: fileName,
        filePath: filePath,
        downloadUrl: `/reports/${fileName}`
      };
      
    } catch (error) {
      console.error('❌ Error generating PDF:', error);
      throw error;
    }
  }

  /**
   * Generate Excel report
   */
  async generateExcelReport(data, reportType, title) {
    try {
      console.log(`📊 Generating Excel report: ${title}`);
      
      const fileName = `${reportType}_${Date.now()}.xlsx`;
      const filePath = path.join(this.reportsDir, fileName);
      
      // Create workbook
      const workbook = XLSX.utils.book_new();
      
      // Convert data to worksheet
      const worksheet = XLSX.utils.json_to_sheet(data);
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, title);
      
      // Write file
      XLSX.writeFile(workbook, filePath);
      
      console.log(`✅ Excel report generated: ${fileName}`);
      return {
        success: true,
        fileName: fileName,
        filePath: filePath,
        downloadUrl: `/reports/${fileName}`
      };
      
    } catch (error) {
      console.error('❌ Error generating Excel:', error);
      throw error;
    }
  }

  /**
   * Add products table to PDF
   */
  addProductsTableToPDF(doc, products) {
    let y = 120;
    
    // Headers
    doc.fontSize(10)
       .text('ID', 50, y)
       .text('Product Name', 80, y)
       .text('Price', 250, y)
       .text('Stock', 300, y)
       .text('Description', 350, y);
    
    y += 20;
    doc.moveTo(50, y).lineTo(550, y).stroke();
    y += 10;
    
    // Data rows
    products.forEach(product => {
      if (y > 700) { // New page if needed
        doc.addPage();
        y = 50;
      }
      
      doc.text(product.ID.toString(), 50, y)
         .text(product.ProductName.substring(0, 20), 80, y)
         .text(`$${product.UnitPrice}`, 250, y)
         .text(product.UnitsInStock.toString(), 300, y)
         .text((product.Description || '').substring(0, 30), 350, y);
      
      y += 15;
    });
  }

  /**
   * Add inventory table to PDF
   */
  addInventoryTableToPDF(doc, products) {
    let y = 120;
    
    // Headers
    doc.fontSize(10)
       .text('Product', 50, y)
       .text('Current Stock', 200, y)
       .text('Status', 300, y)
       .text('Value', 400, y);
    
    y += 20;
    doc.moveTo(50, y).lineTo(500, y).stroke();
    y += 10;
    
    // Data rows with status analysis
    products.forEach(product => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      
      const status = product.UnitsInStock === 0 ? 'OUT OF STOCK' :
                    product.UnitsInStock < 20 ? 'LOW STOCK' : 'IN STOCK';
      const value = (product.UnitPrice * product.UnitsInStock).toFixed(2);
      
      doc.text(product.ProductName.substring(0, 25), 50, y)
         .text(product.UnitsInStock.toString(), 200, y)
         .text(status, 300, y)
         .text(`$${value}`, 400, y);
      
      y += 15;
    });
  }

  /**
   * Add customers table to PDF
   */
  addCustomersTableToPDF(doc, customers) {
    let y = 120;
    
    // Headers
    doc.fontSize(10)
       .text('ID', 50, y)
       .text('Company', 80, y)
       .text('Contact', 200, y)
       .text('Country', 300, y)
       .text('Email', 400, y);
    
    y += 20;
    doc.moveTo(50, y).lineTo(550, y).stroke();
    y += 10;
    
    // Data rows
    customers.forEach(customer => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      
      doc.text(customer.ID.toString(), 50, y)
         .text((customer.CompanyName || '').substring(0, 15), 80, y)
         .text((customer.ContactName || '').substring(0, 15), 200, y)
         .text(customer.Country || '', 300, y)
         .text((customer.Email || '').substring(0, 20), 400, y);
      
      y += 15;
    });
  }

  /**
   * Add generic table to PDF
   */
  addGenericTableToPDF(doc, data) {
    if (!data || data.length === 0) {
      doc.text('No data available', 50, 120);
      return;
    }
    
    const keys = Object.keys(data[0]);
    let y = 120;
    
    // Headers
    doc.fontSize(10);
    keys.forEach((key, index) => {
      doc.text(key, 50 + (index * 100), y);
    });
    
    y += 20;
    doc.moveTo(50, y).lineTo(50 + (keys.length * 100), y).stroke();
    y += 10;
    
    // Data rows
    data.forEach(row => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      
      keys.forEach((key, index) => {
        const value = row[key] ? row[key].toString().substring(0, 15) : '';
        doc.text(value, 50 + (index * 100), y);
      });
      
      y += 15;
    });
  }

  /**
   * Generate summary statistics
   */
  generateSummaryStats(data, type) {
    if (!data || data.length === 0) return {};
    
    switch (type) {
      case 'products':
        return {
          totalProducts: data.length,
          totalValue: data.reduce((sum, p) => sum + (p.UnitPrice * p.UnitsInStock), 0).toFixed(2),
          outOfStock: data.filter(p => p.UnitsInStock === 0).length,
          lowStock: data.filter(p => p.UnitsInStock < 20 && p.UnitsInStock > 0).length,
          averagePrice: (data.reduce((sum, p) => sum + p.UnitPrice, 0) / data.length).toFixed(2)
        };
      case 'customers':
        return {
          totalCustomers: data.length,
          countries: [...new Set(data.map(c => c.Country))].length,
          withEmail: data.filter(c => c.Email).length
        };
      default:
        return { totalRecords: data.length };
    }
  }
}

module.exports = ReportGenerator;
