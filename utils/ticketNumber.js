export const parsePositiveInt = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
};

export const nextTicketNumber = async (client) => {
  const result = await client.query(`SELECT nextval('support_ticket_number_seq') AS n`);
  return `SUP-${String(result.rows[0].n).padStart(6, '0')}`;
};

export const httpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};
