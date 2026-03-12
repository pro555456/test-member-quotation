function buildInClause(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      clause: '(NULL)',
      params: [],
    };
  }

  return {
    clause: `(${values.map(() => '?').join(',')})`,
    params: values,
  };
}

module.exports = {
  buildInClause,
};
