// Used as input
// { preserveReferences: true }
export default (() => {
  const var0 = {
      number: 1,
      string: 'Hello',
      nothing: null,
      [Symbol.for('key')]: 'value'
    },
    var1 = new Date(1),
    var2 = new Date(2)
  var0['new Date(1)'] = var1
  var0['new Date(2)'] = var2
  return var0
})()

// -------------------------------------------------------------------------------------------------

// Default output
// { preserveReferences: false }
const withoutPreserveReferences = {
  number: 1,
  string: 'Hello',
  nothing: null,
  'new Date(1)': new Date(1),
  'new Date(2)': new Date(2),
  [Symbol.for('key')]: 'value'
}
