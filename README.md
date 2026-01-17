# Tax Form Annotation System

A universal annotation specification for U.S. tax forms that enables programmatic form filling.

---

## Overview

This system provides a **standardized way to annotate any U.S. tax form** (1040, W-2, W-8BEN, 1099, etc.) so that applications can print values in the correct positions.

### Key Design Goals

1. **Universal** - Same schema works for any tax form
2. **Maintainable** - Adding a new form = adding a new JSON file
3. **Flexible** - Supports coordinate-based rendering AND native PDF fields
4. **Type-aware** - Built-in formatting for currency, SSN, dates, etc.
5. **Data-agnostic** - Uses dot-notation binding to work with any data structure

---

## Quick Start

```bash
# Install
npm install

# Fill a 1040
npm run fill:1040
```

Or with custom files:
```bash
node renderer/render.js forms/f1040.pdf annotations/1040.json data/sample-1040.json output/filled-1040.pdf
```

---

## Annotation Schema

### Form Metadata

```json
{
  "form": {
    "id": "irs-1040",
    "name": "U.S. Individual Income Tax Return",
    "year": 2025,
    "pages": 2,
    "pageSize": { "width": 612, "height": 792, "unit": "pt" }
  }
}
```

### Field Definition

Each field requires:

| Property | Required | Description |
|----------|----------|-------------|
| `id` | ✓ | Unique identifier |
| `label` | ✓ | Human-readable description |
| `page` | ✓ | Page number (1-indexed) |
| `type` | ✓ | `text`, `currency`, `ssn`, `ein`, `date`, `checkbox`, `radio`, `number` |
| `position` | ✓ | x, y, width, height coordinates |
| `binding` | ✓ | Data path + optional transform |
| `format` | | Rendering options |
| `nativeFieldId` | | PDF form field ID (optimization) |

### Example Field

```json
{
  "id": "line_1a",
  "label": "Line 1a - Total W-2 wages",
  "page": 1,
  "type": "currency",
  "position": { "x": 504, "y": 330, "width": 72, "height": 12 },
  "binding": {
    "path": "income.w2[*].wages",
    "transform": "sum"
  },
  "format": { "align": "right", "decimalPlaces": 2 },
  "nativeFieldId": "topmostSubform[0].Page1[0].f1_47[0]"
}
```

---

## Position Specification

```json
{
  "position": {
    "x": 100,      // Distance from LEFT edge
    "y": 200,      // Distance from BOTTOM edge (PDF standard)
    "width": 150,
    "height": 14,
    "unit": "pt"   // "pt" (default), "in", or "mm"
  }
}
```

**Note:** PDF coordinates have origin at bottom-left. Y increases upward.

---

## Data Binding

The `binding.path` uses dot notation to reference values from deeply nested data:

| Path | Resolves To |
|------|-------------|
| `taxpayer.name.first` | First name |
| `taxpayer.address.city` | City |
| `income.w2[0].wages` | First W-2 wages |
| `income.w2[*].wages` | Array of all W-2 wages (use with `transform: "sum"`) |
| `filingStatus.single` | Boolean for checkbox |

### Transforms

| Transform | Description |
|-----------|-------------|
| `uppercase` | Convert to uppercase |
| `lowercase` | Convert to lowercase |
| `trim` | Remove whitespace |
| `sum` | Sum array values |
| `count` | Count array items |

### Conditional Rendering

```json
{
  "binding": {
    "path": "digitalAssets.hasActivity",
    "condition": "digitalAssets.hasActivity === true"
  }
}
```

---

## Field Types & Formatting

### Currency
```json
{
  "type": "currency",
  "format": {
    "decimalPlaces": 2,
    "currencySymbol": false,
    "align": "right"
  }
}
```
Input: `57890.5` → Output: `57,890.50`

### SSN
```json
{ "type": "ssn" }
```
Input: `123456789` → Output: `123-45-6789`

### Date
```json
{
  "type": "date",
  "format": { "dateFormat": "MM/DD/YYYY" }
}
```

### Checkbox
```json
{
  "type": "checkbox",
  "format": { "checkMark": "X" }  // Options: "X", "✓", "●", "filled"
}
```

---

## Architecture

```
tax-form-annotation-system/
├── schema/
│   └── annotation.schema.json    # JSON Schema for validation
├── annotations/
│   ├── 1040.json                 # 1040 field definitions
│   └── {form}.json               # Any additional form
├── renderer/
│   └── render.js                 # Universal rendering engine
├── forms/                        # Blank PDF forms
├── data/                         # Sample input data
└── output/                       # Generated filled PDFs
```

---

## Rendering Modes

The renderer supports two modes:

### 1. Native PDF Fields (Preferred)
If `nativeFieldId` is provided and the PDF has fillable form fields:
- Uses `form.getTextField(id).setText(value)`
- Pixel-perfect positioning
- Respects field constraints

### 2. Coordinate-Based (Fallback)
If no native fields available:
- Uses `page.drawText()` at specified coordinates
- Works on any PDF (scanned, flat, etc.)

---

## Sample Input Data Structure

```json
{
  "taxpayer": {
    "name": { "first": "John", "middle": "A", "last": "Doe" },
    "ssn": "123456789",
    "address": {
      "line1": "123 Main Street",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94105"
    },
    "occupation": "Software Engineer"
  },
  "filingStatus": {
    "single": true,
    "marriedJoint": false
  },
  "income": {
    "w2": [
      { "employer": "Acme Corp", "wages": 75000, "federalWithheld": 12000 }
    ],
    "interest": { "taxable": 500 },
    "total": 75500
  },
  "payments": {
    "federalWithholding": { "total": 12000 }
  }
}
```

---

## Future Enhancements

1. **Visual Annotation Tool** - Click-to-define field positions on PDF
2. **Validation Rules** - Min/max values, required fields, cross-field validation
3. **Calculated Fields** - Auto-compute totals (line 9 = sum of lines 1-8)
4. **Multi-language** - Localized labels and formats
5. **Version Management** - Track form revisions across tax years
6. **Batch Processing** - Fill multiple returns from CSV/database
7. **Audit Trail** - Log which fields were filled and their sources

---

## License

ISC
