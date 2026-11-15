import { PDFDocument, PDFTextField, PDFCheckBox, StandardFonts } from 'pdf-lib';
import { applicationFields } from './longstay-application.js';

// Used once ProHouse supplies its branded mail-merge PDF template.
// Supports AcroForm PDFs with native text/checkbox widgets. For a flat PDF,
// provide the field-to-page/coordinate mapping after the template is uploaded.
const keys = new Set(applicationFields.map(([key])=>key));
const namesToKeys = new Map(applicationFields.flatMap(([key,label]) => [
  [key.toLowerCase().replace(/[^a-z0-9]/g,''),key],
  [label.toLowerCase().replace(/[^a-z0-9]/g,''),key]
]));
function pdfText(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\x20-\x7E]/g,'?').slice(0,2000);
}
/**
 * @param {Uint8Array} templateBytes PDF template with named AcroForm fields
 * @param {Record<string,string>} application submitted data keys
 * @param {Record<string,string>} fieldMap optional { 'PDF Field Name': 'formFieldKey' }
 * @param {{flatten?: boolean}} options
 * @returns {Promise<Uint8Array>}
 */
export async function mergeApplicationTemplate(templateBytes, application, fieldMap={}, options={flatten:true}){
  const doc=await PDFDocument.load(templateBytes);
  const form=doc.getForm();
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const found=[];
  for(const field of form.getFields()){
    const name=field.getName();
    const explicit=fieldMap[name];
    const key=keys.has(explicit) ? explicit : namesToKeys.get(name.toLowerCase().replace(/[^a-z0-9]/g,''));
    if(!key)continue;
    const value=String(application[key]??'');
    if(field instanceof PDFTextField){field.setText(pdfText(value));found.push(name);}
    if(field instanceof PDFCheckBox){value.toLowerCase()==='yes'?field.check():field.uncheck();found.push(name);}
  }
  if(!found.length)throw Error('No matching fillable fields found. Flat PDF requires field positions.');
  form.updateFieldAppearances(font);
  if(options.flatten)form.flatten();
  return {bytes:new Uint8Array(await doc.save()),filledFields:found};
}
