/** Ten inspectable layouts; keep alongside generator-version/hash regressions. */
export const SHOWCASE_CIRCUIT_SEEDS: readonly string[] = Array.from(
  { length: 10 },
  (_, index) => `regression-${index}`
);
export const EXPECTED_FIRST_CIRCUIT_HASH =
  '3a8c5a170119d7e039ca1c244d68ea76e0802604c83aea343101c58cfaa1b1df';
export const EXPECTED_RESERVE_CIRCUIT_HASH =
  'd956fc9612a3bc90fe5bae3c08d592217d50787d496a1855148e80c6efaf8c56';
