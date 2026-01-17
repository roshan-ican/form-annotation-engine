/**
 * Universal Tax Form Renderer
 * 
 * Works with ANY tax form as long as you provide an annotation JSON.
 * Supports both coordinate-based rendering and native PDF field filling.
 */

const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

/**
 * Get nested value from object using dot notation
 * Supports array notation: "income.w2[0].wages" or "income.w2[*].wages" (for transform)
 */
function getNestedValue(obj, pathStr, defaultValue = null) {
  if (!pathStr) return defaultValue;
  
  // Handle array wildcard [*] - used with transform: "sum"
  if (pathStr.includes("[*]")) {
    const [arrayPath, rest] = pathStr.split("[*]");
    const array = getNestedValue(obj, arrayPath, []);
    if (!Array.isArray(array)) return defaultValue;
    
    const restPath = rest.startsWith(".") ? rest.slice(1) : rest;
    return array.map(item => restPath ? getNestedValue(item, restPath) : item);
  }
  
  // Handle specific array index [0], [1], etc.
  const keys = pathStr.replace(/\[(\d+)\]/g, ".$1").split(".");
  let value = obj;
  
  for (const key of keys) {
    if (value === null || value === undefined) return defaultValue;
    value = value[key];
  }
  
  return value ?? defaultValue;
}

/**
 * Apply transform to value
 */
function applyTransform(value, transform) {
  if (!transform) return value;
  
  switch (transform) {
    case "uppercase":
      return String(value).toUpperCase();
    case "lowercase":
      return String(value).toLowerCase();
    case "trim":
      return String(value).trim();
    case "sum":
      if (Array.isArray(value)) {
        return value.reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
      }
      return value;
    case "count":
      return Array.isArray(value) ? value.length : 0;
    default:
      return value;
  }
}

/**
 * Format value based on field type
 */
function formatValue(value, field) {
  if (value === null || value === undefined || value === "") return "";
  
  const format = field.format || {};
  
  switch (field.type) {
    case "currency":
      const num = parseFloat(value);
      if (isNaN(num)) return "";
      const decimals = format.decimalPlaces ?? 2;
      const formatted = num.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      return format.currencySymbol ? `$${formatted}` : formatted;
    
    case "number":
      const n = parseFloat(value);
      if (isNaN(n)) return "";
      return n.toLocaleString("en-US", {
        minimumFractionDigits: format.decimalPlaces ?? 0,
        maximumFractionDigits: format.decimalPlaces ?? 0,
      });
    
    case "ssn":
      const digits = String(value).replace(/\D/g, "");
      if (digits.length === 9) {
        return `${digits.slice(0,3)}-${digits.slice(3,5)}-${digits.slice(5)}`;
      }
      return digits;
    
    case "ein":
      const einDigits = String(value).replace(/\D/g, "");
      if (einDigits.length === 9) {
        return `${einDigits.slice(0,2)}-${einDigits.slice(2)}`;
      }
      return einDigits;
    
    case "date":
      const dateFormat = format.dateFormat || "MM/DD/YYYY";
      const date = new Date(value);
      if (isNaN(date)) return String(value);
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const yyyy = date.getFullYear();
      return dateFormat
        .replace("MM", mm)
        .replace("DD", dd)
        .replace("YYYY", yyyy);
    
    case "checkbox":
      return Boolean(value);
    
    default:
      return String(value);
  }
}

/**
 * Evaluate condition string
 */
function evaluateCondition(condition, data) {
  if (!condition) return true;
  
  // Simple condition parsing: "path === value" or "path !== value"
  const match = condition.match(/^(.+?)\s*(===|!==|==|!=)\s*(.+)$/);
  if (!match) return true;
  
  const [, pathStr, operator, expectedStr] = match;
  const actualValue = getNestedValue(data, pathStr.trim());
  
  let expected = expectedStr.trim();
  if (expected === "true") expected = true;
  else if (expected === "false") expected = false;
  else if (expected === "null") expected = null;
  else if (!isNaN(expected)) expected = parseFloat(expected);
  
  switch (operator) {
    case "===":
    case "==":
      return actualValue === expected;
    case "!==":
    case "!=":
      return actualValue !== expected;
    default:
      return true;
  }
}

/**
 * Fill PDF using coordinate-based annotations
 */
async function fillWithCoordinates(pdfDoc, annotation, data) {
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  let filledCount = 0;
  
  for (const field of annotation.fields) {
    // Check condition
    if (!evaluateCondition(field.binding.condition, data)) {
      continue;
    }
    
    // Get value
    let value = getNestedValue(data, field.binding.path, field.binding.fallback);
    
    // Apply transform
    value = applyTransform(value, field.binding.transform);
    
    // Format value
    const formattedValue = formatValue(value, field);
    
    if (formattedValue === "" && field.type !== "checkbox") continue;
    
    // Get page (0-indexed internally)
    const page = pages[field.page - 1];
    if (!page) {
      console.warn(`Page ${field.page} not found for field ${field.id}`);
      continue;
    }
    
    const pos = field.position;
    const format = field.format || {};
    const fontSize = format.fontSize || 10;
    
    if (field.type === "checkbox") {
      if (formattedValue === true) {
        const checkMark = format.checkMark || "X";
        const centerX = pos.x + pos.width / 2;
        const centerY = pos.y + pos.height / 2;
        
        page.drawText(checkMark, {
          x: centerX - fontSize / 4,
          y: centerY - fontSize / 3,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        filledCount++;
      }
    } else {
      // Calculate text position based on alignment
      let textX = pos.x + 2;
      const textWidth = font.widthOfTextAtSize(String(formattedValue), fontSize);
      
      if (format.align === "right") {
        textX = pos.x + pos.width - textWidth - 2;
      } else if (format.align === "center") {
        textX = pos.x + (pos.width - textWidth) / 2;
      }
      
      page.drawText(String(formattedValue), {
        x: textX,
        y: pos.y + (pos.height - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      filledCount++;
    }
  }
  
  return filledCount;
}

/**
 * Fill PDF using native form fields (when available)
 */
async function fillWithNativeFields(pdfDoc, annotation, data) {
  const form = pdfDoc.getForm();
  let filledCount = 0;
  let fallbackCount = 0;
  
  for (const field of annotation.fields) {
    // Check condition
    if (!evaluateCondition(field.binding.condition, data)) {
      continue;
    }
    
    // Skip if no native field ID
    if (!field.nativeFieldId) {
      fallbackCount++;
      continue;
    }
    
    // Get value
    let value = getNestedValue(data, field.binding.path, field.binding.fallback);
    value = applyTransform(value, field.binding.transform);
    const formattedValue = formatValue(value, field);
    
    if (formattedValue === "" && field.type !== "checkbox") continue;
    
    try {
      if (field.type === "checkbox") {
        if (formattedValue === true) {
          const checkbox = form.getCheckBox(field.nativeFieldId);
          checkbox.check();
          filledCount++;
        }
      } else {
        const textField = form.getTextField(field.nativeFieldId);
        // SSN fields often have maxLength, so strip dashes
        const valueToSet = field.type === "ssn" 
          ? String(formattedValue).replace(/-/g, "")
          : String(formattedValue);
        textField.setText(valueToSet);
        filledCount++;
      }
    } catch (err) {
      console.warn(`Could not fill native field ${field.nativeFieldId}: ${err.message}`);
    }
  }
  
  return { filledCount, fallbackCount };
}

/**
 * Main render function
 */
async function render(pdfPath, annotationPath, dataPath, outputPath, options = {}) {
  console.log("Loading PDF:", pdfPath);
  console.log("Loading annotation:", annotationPath);
  console.log("Loading data:", dataPath);
  
  // Load files
  const pdfBytes = fs.readFileSync(pdfPath);
  const annotation = JSON.parse(fs.readFileSync(annotationPath, "utf-8"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  
  // Load PDF
  const pdfDoc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
  });
  
  // Determine rendering mode
  const hasNativeFields = annotation.fields.some(f => f.nativeFieldId);
  const useNative = options.useNativeFields !== false && hasNativeFields;
  
  let result;
  if (useNative) {
    console.log("Using native PDF fields...");
    result = await fillWithNativeFields(pdfDoc, annotation, data);
    
    // Fallback to coordinates for fields without nativeFieldId
    if (result.fallbackCount > 0) {
      console.log(`Falling back to coordinates for ${result.fallbackCount} fields...`);
      // Filter to only non-native fields and render with coordinates
      const nonNativeAnnotation = {
        ...annotation,
        fields: annotation.fields.filter(f => !f.nativeFieldId)
      };
      const coordCount = await fillWithCoordinates(pdfDoc, nonNativeAnnotation, data);
      result.filledCount += coordCount;
    }
  } else {
    console.log("Using coordinate-based rendering...");
    result = { filledCount: await fillWithCoordinates(pdfDoc, annotation, data) };
  }
  
  // Save
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);
  
  console.log(`\n✓ PDF generated: ${outputPath}`);
  console.log(`  Fields filled: ${result.filledCount}`);
  
  return result;
}

// CLI
const args = process.argv.slice(2);
if (args.length < 3) {
  console.log("Usage: node render.js <pdf> <annotation.json> <data.json> [output.pdf]");
  console.log("\nExample:");
  console.log("  node render.js forms/f1040.pdf annotations/1040.json data/taxpayer.json output/filled.pdf");
  process.exit(1);
}

const [pdfPath, annotationPath, dataPath, outputPath = "filled.pdf"] = args;

render(pdfPath, annotationPath, dataPath, outputPath).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

module.exports = { render, getNestedValue, formatValue, applyTransform };
