function reconciliationGuardError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function validatedOrdersConnection(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_BODY_INVALID');
  }
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_DATA_MISSING');
  }
  const connection = body.data.orders;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_ORDERS_MISSING');
  }
  if (!Array.isArray(connection.nodes)) {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_NODES_INVALID');
  }
  const pageInfo = connection.pageInfo;
  if (!pageInfo || typeof pageInfo !== 'object' || Array.isArray(pageInfo) || typeof pageInfo.hasNextPage !== 'boolean') {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_PAGE_INFO_INVALID');
  }
  const endCursor = typeof pageInfo.endCursor === 'string' && pageInfo.endCursor.trim()
    ? pageInfo.endCursor.trim()
    : null;
  if (pageInfo.hasNextPage && !endCursor) {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_END_CURSOR_MISSING');
  }
  return {
    nodes: connection.nodes,
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor,
    },
  };
}

export function assertReconciliationPageFetched(pages) {
  if (!Number.isInteger(pages) || pages < 1) {
    throw reconciliationGuardError('SHOPIFY_RECONCILIATION_DEADLINE_BEFORE_FIRST_PAGE');
  }
}
