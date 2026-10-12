/** Complete the owner's visible vehicle step before exercising controls/settings in a real joined lobby. */
export async function confirmInitialVehicle(page) {
  await page.waitForFunction(() => {
    const phase = window.__jjController?.inspect().roomPhase;
    return phase && (phase !== 'Lobby' || document.querySelector('[data-overlay=cars]') || document.querySelector('[data-act=ready]')?.disabled === false);
  }, undefined, {timeout:30000});
  const use = page.locator('[data-overlay=cars] [data-act=car-done]');
  if (await use.isVisible()) await use.click();
}
