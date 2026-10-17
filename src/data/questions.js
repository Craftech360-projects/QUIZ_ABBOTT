import siteA from '../images/site-a.png';
import siteB from '../images/site-b.png';
import siteC from '../images/site-c.png';
import siteD from '../images/site-d.png';

export const quizConfig = {
  questionCount: 10,
  secondsPerQuestion: 45,
  safeLevels: [4, 8],
};

// Explanation references (product wording and clinical context):
// https://pro.freestyle.abbott/ie-en/home/freestyle-portfolio/freestyle-libre-systems/freestyle-libre-2/freestyle-libre-2-plus-sensor.html
// https://pro.freestyle.abbott/uk-en/freestyle-portfolio/freestyle-libre-systems/freestyle-libre-2.html
// https://www.freestyle.abbott/content/dam/adc/freestyle/tr/documents/FreeStyle%20Libre%202%20Plus%20Kullan%C4%B1m%20K%C4%B1lavuzu.pdf
// https://www.freestyle.abbott/content/dam/adc/freestyle/countries/us-en/documents/get-started-guide-FSL2-Plus.pdf
// https://www.govinfo.gov/app/details/CFR-2023-title21-vol8/CFR-2023-title21-vol8-sec862-1355
// https://diabetesjournals.org/care/article/49/Supplement_1/S321/163918
export const questions = [
  {
    id: 'q1',
    explanation: 'The sensor updates glucose every minute, helping you follow changes throughout the day.',
    text: 'FreeStyle Libre 2 Plus provides glucose readings at what frequency?',
    options: [
      { id: 'a', text: 'Every 5 minutes' },
      { id: 'b', text: 'Every 15 minutes' },
      { id: 'c', text: 'Every hour' },
      { id: 'd', text: 'Every minute' },
    ],
    correctOptionId: 'd',
  },
  {
    id: 'q2',
    explanation: 'FreeStyle Libre 2 Plus is indicated for people with diabetes aged 2 years and older, including children and adults.',
    text: 'FreeStyle Libre 2 Plus is indicated for people of which age group?',
    options: [
      { id: 'a', text: 'Adults only' },
      { id: 'b', text: 'Children above 10 years' },
      { id: 'c', text: 'People aged 2 years and older' },
      { id: 'd', text: 'People aged 18 years and older' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q3',
    explanation: 'Store the sensor kit between 4°C and 25°C. Keep it within this temperature range and do not freeze it.',
    text: 'What is the temperature range at which FreeStyle Libre 2 Plus must be stored?',
    options: [
      { id: 'a', text: '2 to 8 C' },
      { id: 'b', text: '4 to 25 C' },
      { id: 'c', text: '-10 to -20 C' },
      { id: 'd', text: 'No specific storage conditions' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q4',
    explanation: 'Use a finger-prick test when readings or alarms do not match symptoms or expectations, or when the device instructs you to check.',
    text: 'Which statement about finger prick testing with FreeStyle Libre 2 Plus is correct?',
    options: [
      { id: 'a', text: 'Finger pricks are mandatory before every reading' },
      { id: 'b', text: 'Finger pricks are required daily' },
      { id: 'c', text: 'Finger pricks are never required' },
      { id: 'd', text: "Finger pricks are required only if readings don't match symptoms" },
    ],
    correctOptionId: 'd',
  },
  {
    id: 'q5',
    explanation: 'Studies show lower HbA1c, more time in the target range, and less time with low glucose. All three are clinical benefits.',
    text: 'Which of the following is a proven clinical benefit of FreeStyle Libre systems?',
    options: [
      { id: 'a', text: 'Reduced HbA1c' },
      { id: 'b', text: 'Increased Time in Range' },
      { id: 'c', text: 'Reduced hypoglycaemia' },
      { id: 'd', text: 'All the above' },
    ],
    correctOptionId: 'd',
  },
  {
    id: 'q6',
    explanation: 'Apply the sensor to the back of the upper arm. This is the approved site for FreeStyle Libre 2 Plus.',
    text: 'Correct site of application of a sensor:',
    options: [
      { id: 'a', text: 'Site option A', image: siteA },
      { id: 'b', text: 'Site option B', image: siteB },
      { id: 'c', text: 'Site option C', image: siteC },
      { id: 'd', text: 'Site option D', image: siteD },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q7',
    text: 'In patients receiving GLP 1 receptor agonist therapy, FreeStyle Libre use results in:',
    options: [
      { id: 'a', text: 'No additional benefit' },
      { id: 'b', text: 'Reduced insulin requirement only' },
      { id: 'c', text: 'Greater HbA1c reduction' },
      { id: 'd', text: 'Increased hypoglycaemia' },
    ],
    correctOptionIds: ['b', 'c'],
  },
  {
    id: 'q8',
    explanation: 'HbA1c reflects average glucose over time. CGM adds daily patterns and highs and lows that an average can hide.',
    text: 'What do ADA and APAC guidelines recommend for glucose monitoring?',
    options: [
      { id: 'a', text: 'HbA1c alone is sufficient' },
      { id: 'b', text: 'BGM should replace CGM' },
      { id: 'c', text: 'CGM along with HbA1c for people with diabetes' },
      { id: 'd', text: 'CGM only for Type 1 Diabetes' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q9',
    explanation: 'CGM tracks glucose throughout the day and night, showing trends between readings. A finger-prick test gives a single snapshot.',
    text: 'Compared to traditional blood glucose monitoring (BGM), CGM provides:',
    options: [
      { id: 'a', text: 'Less glucose data' },
      { id: 'b', text: 'Only fasting glucose values' },
      { id: 'c', text: 'Continuous, real time glucose trends' },
      { id: 'd', text: 'Only laboratory based readings' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q10',
    explanation: 'LibreView stores glucose data in the cloud and turns it into reports that patients can share with their healthcare team.',
    text: 'What is LibreView?',
    options: [
      { id: 'a', text: 'A glucose sensor' },
      { id: 'b', text: 'A laboratory software' },
      { id: 'c', text: 'A cloud based CGM data management platform' },
      { id: 'd', text: 'An insulin delivery system' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q11',
    text: "It is mandatory to connect HCP's LibreView account with patient's FreeStyle LibreLink App, to view the AGP report",
    options: [
      { id: 'a', text: 'True' },
      { id: 'b', text: 'False' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q12',
    text: "Patient's caregiver can get real time readings and alarms while patient is using FreeStyle Libre 2 Plus sensor",
    options: [
      { id: 'a', text: 'True' },
      { id: 'b', text: 'False' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q13',
    explanation: 'iCGM criteria assess accuracy across glucose levels and trends. MARD alone cannot describe every aspect of CGM performance.',
    text: 'Which of the following statement is true?',
    options: [
      { id: 'a', text: 'When it comes to clinical outcomes and patient safety, not all CGMs are created equal' },
      { id: 'b', text: 'US FDA requirements for Integrated Continuous Glucose Monitoring (iCGM) are the most rigorous of any major regulatory body' },
      { id: 'c', text: 'MARD alone may not reflect clinical accuracy across the entire glucose range' },
      { id: 'd', text: 'All the above' },
    ],
    correctOptionId: 'd',
  },
  {
    id: 'q14',
    explanation: 'iCGM accuracy is assessed across low, normal and high glucose levels, including times when glucose is rising or falling.',
    text: 'iCGM systems are required to meet accuracy performance:',
    options: [
      { id: 'a', text: 'Only during stable glucose periods' },
      { id: 'b', text: 'Only in adults' },
      { id: 'c', text: 'Across the entire glucose range and rate of change conditions' },
      { id: 'd', text: 'Only above 70 mg/dL' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q15',
    text: 'FreeStyle Libre 2 Plus is approved for usage in patients with GDM:',
    options: [
      { id: 'a', text: 'True' },
      { id: 'b', text: 'False' },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q16',
    text: "Alarms in FreeStyle Libre 2 Plus can be customized as per the HCP's recommendation:",
    options: [
      { id: 'a', text: 'True - the glycemic limits for the alarms can be altered' },
      { id: 'b', text: "False - they are factory calibrated and hence can't be altered" },
    ],
    correctOptionId: 'a',
  },
  {
    id: 'q17',
    explanation: 'Each FreeStyle Libre 2 Plus sensor can be worn for up to 15 days before it needs replacing.',
    text: 'FreeStyle Libre 2 Plus can be used for:',
    options: [
      { id: 'a', text: '7 days' },
      { id: 'b', text: '10 days' },
      { id: 'c', text: '14 days' },
      { id: 'd', text: '15 days' },
    ],
    correctOptionId: 'd',
  },
  {
    id: 'q18',
    explanation: 'The overall MARD is 8.2%: the average relative difference between sensor readings and reference glucose measurements.',
    text: 'FreeStyle Libre 2 Plus has a MARD of:',
    options: [
      { id: 'a', text: '11.7%' },
      { id: 'b', text: '9.4%' },
      { id: 'c', text: '8.2%' },
      { id: 'd', text: '9.1%' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q19',
    explanation: 'The pregnancy CGM target range is 63–140 mg/dL. This is a sensor range, distinct from fasting or after-meal blood glucose targets.',
    text: 'What is the recommended glycemic range for an expectant mother?',
    options: [
      { id: 'a', text: '70 - 180 mg/dl' },
      { id: 'b', text: '80 - 170 mg/dl' },
      { id: 'c', text: '63 - 140 mg/dl' },
      { id: 'd', text: '70 - 140 mg/dl' },
    ],
    correctOptionId: 'c',
  },
  {
    id: 'q20',
    explanation: 'The sensor is approved for the back of the upper arm. Choose a different spot there when replacing a sensor.',
    text: 'What is the correct site of application for FreeStyle Libre 2 Plus sensor?',
    options: [
      { id: 'a', text: 'Side of the arm' },
      { id: 'b', text: 'Back side of the upper arm' },
      { id: 'c', text: 'Stomach' },
      { id: 'd', text: 'Any site on the body' },
    ],
    correctOptionId: 'b',
  },
];
