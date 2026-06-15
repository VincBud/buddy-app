type FontWeight = '400' | '500' | '600' | '700' | '800';

/**
 * createFont — builds a font role config.
 *
 * TO SWITCH THE WHOLE APP TO A CUSTOM FONT:
 * Add a `family` argument here and include `fontFamily` in the returned object.
 * Nothing else in the codebase needs to change.
 *
 * Example (Satoshi):
 *   const createFont = (weight: FontWeight, family: string) => ({
 *     fontFamily: family,
 *     fontWeight: weight,
 *   });
 *   export const fonts = {
 *     regular:  createFont('400', 'Satoshi-Regular'),
 *     ...
 *   };
 */
const createFont = (weight: FontWeight) => ({ fontWeight: weight });

export const fonts = {
  regular:  createFont('400'),
  medium:   createFont('500'),
  semibold: createFont('600'),
  bold:     createFont('700'),
  black:    createFont('800'),
};

export const typography = {
  screenTitle:     { fontSize: 30, ...fonts.black,    lineHeight: 36 },
  sectionTitle:    { fontSize: 20, ...fonts.bold,     lineHeight: 26 },
  cardTitle:       { fontSize: 17, ...fonts.bold,     lineHeight: 22 },
  body:            { fontSize: 16, ...fonts.medium,   lineHeight: 22 },
  bodyStrong:      { fontSize: 16, ...fonts.semibold, lineHeight: 22 },
  meta:            { fontSize: 13, ...fonts.medium,   lineHeight: 18 },
  metaStrong:      { fontSize: 14, ...fonts.semibold, lineHeight: 20 },
  button:          { fontSize: 16, ...fonts.black,    lineHeight: 20 },
  buttonSecondary: { fontSize: 15, ...fonts.bold,     lineHeight: 20 },
};
