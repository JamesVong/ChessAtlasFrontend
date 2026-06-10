import { test, expect, type Page } from '@playwright/test';

/**
 * Regression tests for chess board piece/square alignment on the Explorer page.
 *
 * Root cause of the original iPad bug: the board wrapper was sized with `vh`
 * (large viewport) inside a `100dvh` shell (small viewport). When the
 * viewport is too short for board + controls + move history, the flex column
 * squashes the board wrapper's height (width stays), the wrap goes non-square,
 * and chessground renders pieces on a non-square grid over a square,
 * cover-cropped background image — pieces drift off their squares.
 *
 * These tests assert, across a matrix of viewports and after dynamic changes
 * (rotation, moves, orientation flip), that:
 *   1. cg-board is square,
 *   2. every piece is exactly the size of one square,
 *   3. every piece sits exactly on the 8x8 grid.
 */

interface BoardMeasurement {
  board: { width: number; height: number };
  wrapper: { width: number; height: number };
  pieces: Array<{ left: number; top: number; width: number; height: number }>;
}

async function mockLookupApi(page: Page) {
  await page.route('**/lookup-position*', route =>
    route.fulfill({ json: { status: 'success', data: [] } }),
  );
}

async function openExplorer(page: Page) {
  await mockLookupApi(page);
  await page.goto('/explorer');
  await page.waitForSelector('.explorer-board-wrapper piece');
  // let initial render/animations settle
  await page.waitForTimeout(400);
}

async function measureBoard(page: Page): Promise<BoardMeasurement> {
  return page.evaluate(() => {
    const wrapperEl = document.querySelector('.explorer-board-wrapper')!;
    const boardEl = wrapperEl.querySelector('cg-board')!;
    const b = boardEl.getBoundingClientRect();
    const w = wrapperEl.getBoundingClientRect();
    const pieces = Array.from(wrapperEl.querySelectorAll('piece'))
      .filter(p => !p.classList.contains('ghost'))
      .map(p => {
        const r = p.getBoundingClientRect();
        return { left: r.left - b.left, top: r.top - b.top, width: r.width, height: r.height };
      });
    return {
      board: { width: b.width, height: b.height },
      wrapper: { width: w.width, height: w.height },
      pieces,
    };
  });
}

function assertAligned(m: BoardMeasurement, label: string) {
  const ctx = `${label} (wrapper ${m.wrapper.width.toFixed(1)}x${m.wrapper.height.toFixed(1)}, board ${m.board.width.toFixed(1)}x${m.board.height.toFixed(1)})`;

  expect(m.board.width, `${ctx}: board has zero width`).toBeGreaterThan(50);
  expect(
    Math.abs(m.board.width - m.board.height),
    `${ctx}: board must be square`,
  ).toBeLessThanOrEqual(1.5);

  const sqW = m.board.width / 8;
  const sqH = m.board.height / 8;
  expect(m.pieces.length, `${ctx}: pieces missing`).toBeGreaterThan(0);

  for (const p of m.pieces) {
    expect(Math.abs(p.width - sqW), `${ctx}: piece width ${p.width} != square ${sqW}`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(p.height - sqH), `${ctx}: piece height ${p.height} != square ${sqH}`).toBeLessThanOrEqual(1.5);

    const fx = p.left / sqW;
    const fy = p.top / sqH;
    expect(
      Math.abs(fx - Math.round(fx)),
      `${ctx}: piece at x=${p.left.toFixed(1)} is off the file grid by ${(Math.abs(fx - Math.round(fx)) * sqW).toFixed(1)}px`,
    ).toBeLessThanOrEqual(0.05);
    expect(
      Math.abs(fy - Math.round(fy)),
      `${ctx}: piece at y=${p.top.toFixed(1)} is off the rank grid by ${(Math.abs(fy - Math.round(fy)) * sqH).toFixed(1)}px`,
    ).toBeLessThanOrEqual(0.05);
  }
}

/** Click the centre of a square, given file a-h and rank 1-8 (white POV). */
async function clickSquare(page: Page, square: string) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1], 10);
  const box = await page.locator('.explorer-board-wrapper cg-board').boundingBox();
  if (!box) throw new Error('board not found');
  const s = box.width / 8;
  await page.mouse.click(box.x + (file + 0.5) * s, box.y + (8 - rank + 0.5) * s);
}

const viewports: Array<{
  name: string;
  width: number;
  height: number;
  dpr?: number;
  touch?: boolean;
}> = [
  // The reported device. On the real iPad, Safari's toolbar makes 100dvh ~80px
  // smaller than 100vh; the 754-high case mirrors that visible area.
  { name: 'iPad Pro 11 landscape', width: 1194, height: 834, dpr: 2, touch: true },
  { name: 'iPad Pro 11 landscape, toolbar visible', width: 1194, height: 754, dpr: 2, touch: true },
  { name: 'iPad Pro 11 portrait', width: 834, height: 1194, dpr: 2, touch: true },
  { name: 'iPad Split View', width: 600, height: 834, dpr: 2, touch: true },
  { name: 'iPhone portrait', width: 390, height: 844, dpr: 3, touch: true },
  { name: 'iPhone landscape', width: 844, height: 390, dpr: 3, touch: true },
  { name: 'desktop 1920x1080', width: 1920, height: 1080 },
  { name: 'laptop 1366x768', width: 1366, height: 768 },
  { name: 'short desktop window 1280x620', width: 1280, height: 620 },
  { name: 'very short desktop window 1000x480', width: 1000, height: 480 },
  { name: 'desktop just above mobile breakpoint 861x700', width: 861, height: 700 },
  { name: 'stacked mobile breakpoint 860x700', width: 860, height: 700, touch: true },
];

for (const vp of viewports) {
  test.describe(vp.name, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr ?? 1,
      hasTouch: vp.touch ?? false,
    });

    test('pieces align with squares on load', async ({ page }) => {
      await openExplorer(page);
      assertAligned(await measureBoard(page), vp.name);
    });
  });
}

test.describe('iPad rotation portrait -> landscape', () => {
  test.use({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true });

  test('pieces stay aligned after rotating', async ({ page }) => {
    await openExplorer(page);
    assertAligned(await measureBoard(page), 'portrait before rotation');

    await page.setViewportSize({ width: 1194, height: 834 });
    await page.waitForTimeout(400); // ResizeObserver + re-render
    assertAligned(await measureBoard(page), 'landscape after rotation');
  });
});

test.describe('iPad landscape interactions', () => {
  test.use({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });

  test('pieces stay aligned after a move', async ({ page }) => {
    await openExplorer(page);
    await clickSquare(page, 'e2');
    await clickSquare(page, 'e4');
    await expect(page.locator('.move-history')).toContainText('e4');
    await page.waitForTimeout(400); // move animation
    assertAligned(await measureBoard(page), 'after e4');
  });

  test('pieces stay aligned after flipping orientation', async ({ page }) => {
    await openExplorer(page);
    await page.getByRole('button', { name: 'Black', exact: true }).click();
    await page.waitForTimeout(400);
    assertAligned(await measureBoard(page), 'black orientation');
  });
});

test.describe('desktop interactions', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('pieces stay aligned across several moves', async ({ page }) => {
    await openExplorer(page);
    const moves: Array<[string, string, string]> = [
      ['e2', 'e4', 'e4'],
      ['e7', 'e5', 'e5'],
      ['g1', 'f3', 'Nf3'],
    ];
    for (const [from, to, san] of moves) {
      await clickSquare(page, from);
      await clickSquare(page, to);
      await expect(page.locator('.move-history')).toContainText(san);
      await page.waitForTimeout(400);
      assertAligned(await measureBoard(page), `after ${san}`);
    }
  });

  test('pieces stay aligned after window resize to short height', async ({ page }) => {
    await openExplorer(page);
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.waitForTimeout(400);
    assertAligned(await measureBoard(page), 'after shrink to 1280x620');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(400);
    assertAligned(await measureBoard(page), 'after grow back to 1920x1080');
  });
});
