const fs = require("fs");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

// Load field mapping
const FIELD_MAPPING = require("../annotations/1040.annotations.json");

/**
 * Format SSN - returns digits only (PDF fields have maxLength=9)
 */
function formatSSN(ssn) {
  if (!ssn) return "";
  return String(ssn).replace(/\D/g, "").slice(0, 9);
}

/**
 * Format number as currency (no $ symbol)
 */
function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = parseFloat(value);
  if (isNaN(num) || num === 0) return "";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path, defaultValue = null) {
  const keys = path.split(".");
  let value = obj;
  for (const key of keys) {
    if (value === null || value === undefined) return defaultValue;
    value = value[key];
  }
  return value ?? defaultValue;
}

/**
 * Transform taxpayer data to form field values
 */
function transformData(data) {
  const values = {};

  // Personal Info
  if (data.taxpayer) {
    const firstName = data.taxpayer.name?.first || "";
    const middleInitial = data.taxpayer.name?.middle
      ? ` ${data.taxpayer.name.middle}`
      : "";
    values["taxpayer.firstName"] = firstName + middleInitial;
    values["taxpayer.lastName"] = data.taxpayer.name?.last || "";
    values["taxpayer.ssn"] = formatSSN(data.taxpayer.ssn);
    values["signature.occupation"] =
      data.taxpayer.occupation || data.signatures?.taxpayer?.occupation || "";
  }

  // Spouse Info
  if (data.spouse?.name?.first) {
    const firstName = data.spouse.name.first;
    const middleInitial = data.spouse.name?.middle
      ? ` ${data.spouse.name.middle}`
      : "";
    values["spouse.firstName"] = firstName + middleInitial;
    values["spouse.lastName"] = data.spouse.name?.last || "";
    values["spouse.ssn"] = formatSSN(data.spouse.ssn);
  }

  // Address
  if (data.taxpayer?.address) {
    values["address.street"] = data.taxpayer.address.line1 || "";
    values["address.apt"] = data.taxpayer.address.aptNo || "";
    values["address.city"] = data.taxpayer.address.city || "";
    values["address.state"] = data.taxpayer.address.state || "";
    values["address.zip"] = data.taxpayer.address.zip || "";
  }

  // Income
  if (data.income) {
    const w2Wages =
      data.income.w2?.reduce((sum, w) => sum + (w.wages || 0), 0) || 0;
    values["income.line1a"] = formatCurrency(w2Wages);
    values["income.line1b"] = formatCurrency(data.income.householdEmployeeWages);
    values["income.line1c"] = formatCurrency(data.income.tipIncome);
    values["income.line1d"] = formatCurrency(data.income.medicaidWaiverPayments);
    values["income.line1e"] = formatCurrency(data.income.dependentCareBenefits);
    values["income.line1f"] = formatCurrency(data.income.adoptionBenefits);
    values["income.line1g"] = formatCurrency(data.income.wagesFromForm8919);
    values["income.line1h"] = formatCurrency(data.income.otherEarnedIncome);
    values["income.line1z"] = formatCurrency(data.income.totalEarnedIncome);

    values["income.line2a"] = formatCurrency(data.income.interest?.taxExempt);
    values["income.line2b"] = formatCurrency(data.income.interest?.taxable);
    values["income.line3a"] = formatCurrency(data.income.dividends?.qualified);
    values["income.line3b"] = formatCurrency(data.income.dividends?.ordinary);
    values["income.line4a"] = formatCurrency(data.income.iraDistributions?.total);
    values["income.line4b"] = formatCurrency(data.income.iraDistributions?.taxable);
    values["income.line5a"] = formatCurrency(data.income.pensions?.total);
    values["income.line5b"] = formatCurrency(data.income.pensions?.taxable);
    values["income.line6a"] = formatCurrency(data.income.socialSecurity?.total);
    values["income.line6b"] = formatCurrency(data.income.socialSecurity?.taxable);
    values["income.line7a"] = formatCurrency(data.income.capitalGains?.gainOrLoss);
    values["income.line8"] = formatCurrency(data.income.other?.amount);
    values["income.line9"] = formatCurrency(data.income.total);
  }

  // Adjustments and AGI
  values["income.line10"] = formatCurrency(data.adjustments?.total);
  values["income.line11a"] = formatCurrency(data.adjustedGrossIncome);
  values["tax.line11b"] = formatCurrency(data.adjustedGrossIncome);

  // Deductions
  if (data.deductions) {
    const deduction =
      data.deductions.type === "standard"
        ? data.deductions.standard?.amount
        : data.deductions.itemized?.amount;
    values["tax.line12e"] = formatCurrency(deduction);
    values["tax.line13a"] = formatCurrency(data.deductions.qualifiedBusinessIncome);
    values["tax.line14"] = formatCurrency(deduction);
    
    // Calculate taxable income
    const agi = data.adjustedGrossIncome || 0;
    const totalDeductions = (deduction || 0) + (data.deductions.qualifiedBusinessIncome || 0);
    values["tax.line15"] = formatCurrency(Math.max(0, agi - totalDeductions));
  }

  // Tax
  if (data.tax) {
    values["tax.line16"] = formatCurrency(data.tax.total);
    values["tax.line18"] = formatCurrency(data.tax.total);
    values["tax.line22"] = formatCurrency(data.tax.total);
    values["tax.line24"] = formatCurrency(data.tax.total);
  }

  // Payments
  if (data.payments) {
    values["payments.line25a"] = formatCurrency(data.payments.federalWithholding?.fromW2);
    values["payments.line25b"] = formatCurrency(data.payments.federalWithholding?.from1099);
    values["payments.line25c"] = formatCurrency(data.payments.federalWithholding?.fromOtherForms);
    values["payments.line25d"] = formatCurrency(data.payments.federalWithholding?.total);
    values["payments.line26"] = formatCurrency(data.payments.estimatedTaxPayments);
    values["payments.line33"] = formatCurrency(data.payments.totalPayments);
  }

  // Refund
  if (data.refund) {
    values["refund.line34"] = formatCurrency(data.refund.overpaid);
    values["refund.line35a"] = formatCurrency(data.refund.refundAmount);
    values["refund.line35b"] = data.refund.directDeposit?.routingNumber || "";
    values["refund.line35d"] = data.refund.directDeposit?.accountNumber || "";
    values["refund.line36"] = formatCurrency(data.refund.applyTo2026EstimatedTax);
  }

  // Amount Owed
  if (data.amountOwed) {
    values["owed.line37"] = formatCurrency(data.amountOwed.total);
    values["owed.line38"] = formatCurrency(data.amountOwed.estimatedTaxPenalty);
  }

  return values;
}

/**
 * Get checkbox values based on data
 */
function getCheckboxValues(data) {
  const checkboxes = {};

  // Home in US
  if (data.homeInUS?.taxpayer) {
    checkboxes["homeInUS"] = true;
  }

  // Filing Status (only one can be true)
  if (data.filingStatus) {
    if (data.filingStatus.single) checkboxes["filingStatus.single"] = true;
    else if (data.filingStatus.marriedJoint) checkboxes["filingStatus.marriedJoint"] = true;
    else if (data.filingStatus.marriedSeparate) checkboxes["filingStatus.marriedSeparate"] = true;
    else if (data.filingStatus.headOfHousehold) checkboxes["filingStatus.headOfHousehold"] = true;
    else if (data.filingStatus.qualifyingSurvivingSpouse) checkboxes["filingStatus.qualifyingSurvivingSpouse"] = true;
  }

  // Digital Assets
  if (data.digitalAssets?.hasActivity === true) {
    checkboxes["digitalAssets.yes"] = true;
  } else if (data.digitalAssets?.hasActivity === false) {
    checkboxes["digitalAssets.no"] = true;
  }

  // Presidential Campaign
  if (data.presidentialElectionCampaign?.taxpayer) {
    checkboxes["presidentialCampaign.you"] = true;
  }
  if (data.presidentialElectionCampaign?.spouse) {
    checkboxes["presidentialCampaign.spouse"] = true;
  }

  return checkboxes;
}

/**
 * Fill the PDF form using native form fields
 */
async function fillForm(pdfPath, dataPath, outputPath) {
  console.log("Loading PDF:", pdfPath);
  console.log("Loading data:", dataPath);

  // Load PDF and data
  const pdfBytes = fs.readFileSync(pdfPath);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  const pdfDoc = await PDFDocument.load(pdfBytes);

  // Get the form
  const form = pdfDoc.getForm();

  // Transform data to field values
  const fieldValues = transformData(data);
  const checkboxValues = getCheckboxValues(data);

  let filledCount = 0;
  let errorCount = 0;

  // Fill text fields
  for (const [dataPath, value] of Object.entries(fieldValues)) {
    if (!value) continue;

    const fieldId = FIELD_MAPPING.textFields[dataPath];
    if (!fieldId) {
      continue; // Skip unmapped fields silently
    }

    try {
      const field = form.getTextField(fieldId);
      field.setText(String(value));
      filledCount++;
    } catch (err) {
      console.warn(`Could not set field ${dataPath} (${fieldId}): ${err.message}`);
      errorCount++;
    }
  }

  // Fill checkboxes
  for (const [checkboxPath, isChecked] of Object.entries(checkboxValues)) {
    if (!isChecked) continue;

    const mapping = FIELD_MAPPING.checkboxes[checkboxPath];
    if (!mapping) {
      continue;
    }

    try {
      const field = form.getField(mapping.fieldId);
      // For checkboxes in PDF forms, we need to set the value directly
      if (field.constructor.name === "PDFCheckBox") {
        field.check();
      } else {
        // Radio button or other field type
        field.select(mapping.checkedValue);
      }
      filledCount++;
    } catch (err) {
      console.warn(`Could not set checkbox ${checkboxPath}: ${err.message}`);
      errorCount++;
    }
  }

  // Save the PDF
  const outputBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, outputBytes);

  console.log(`\n✓ PDF generated: ${outputPath}`);
  console.log(`  Fields filled: ${filledCount}`);
  if (errorCount > 0) {
    console.log(`  Errors: ${errorCount}`);
  }
}

// CLI execution
const args = process.argv.slice(2);
const pdfPath = args[0] || path.join(__dirname, "../f1040.pdf");
const dataPath = args[1] || path.join(__dirname, "../data/sample.data.json");
const outputPath = args[2] || path.join(__dirname, "../filled-1040.pdf");

fillForm(pdfPath, dataPath, outputPath).catch((err) => {
  console.error("Error filling form:", err);
  process.exit(1);
});
