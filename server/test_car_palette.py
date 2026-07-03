"""br-car-identity-system — curated car palette + roof number assignment.

Proves cars no longer get confusable random colors: the palette is perceptually
distinct (min pairwise CIE76 well above a couch-distance threshold), assignment
is deterministic by seat index, and every seat gets a persistent roof number.
"""

import unittest

from server.car_palette import (
    CAR_PALETTE,
    color_for_index,
    color_for_seat,
    delta_e,
    number_for_seat,
    palette_min_distance,
)

# CIE76 deltaE: >~10 reads as a different color at a glance, >~20 as clearly
# different. Require a comfortable couch-distance margin.
COUCH_DISTANCE_THRESHOLD = 20.0


class CarPaletteTest(unittest.TestCase):
    def test_palette_colors_are_perceptually_distinct(self):
        self.assertGreaterEqual(len(CAR_PALETTE), 12)
        self.assertGreater(
            palette_min_distance(),
            COUCH_DISTANCE_THRESHOLD,
            "two palette colors are confusable at couch distance",
        )

    def test_all_palette_entries_are_valid_hex(self):
        for color in CAR_PALETTE:
            self.assertRegex(color, r"^#[0-9a-fA-F]{6}$")
        self.assertEqual(len(set(CAR_PALETTE)), len(CAR_PALETTE), "duplicate colors")

    def test_color_assignment_is_deterministic_and_cycles(self):
        self.assertEqual(color_for_index(0), CAR_PALETTE[0])
        self.assertEqual(color_for_index(1), CAR_PALETTE[1])
        # Cycles past the end without collision within a single wrap.
        self.assertEqual(color_for_index(len(CAR_PALETTE)), CAR_PALETTE[0])

    def test_seat_ids_are_one_based(self):
        # seat_id is a 1-based monotonic counter (room['next_player_id']).
        self.assertEqual(color_for_seat(1), CAR_PALETTE[0])
        self.assertEqual(color_for_seat(2), CAR_PALETTE[1])

    def test_first_lobby_worth_of_seats_are_mutually_distinct(self):
        # A realistic lobby (first 8 seats) must be pairwise distinct.
        colors = [color_for_seat(sid) for sid in range(1, 9)]
        for i in range(len(colors)):
            for j in range(i + 1, len(colors)):
                self.assertGreater(
                    delta_e(colors[i], colors[j]),
                    COUCH_DISTANCE_THRESHOLD,
                    f"seats {i+1} and {j+1} are confusable",
                )

    def test_roof_number_is_persistent_and_one_based(self):
        self.assertEqual(number_for_seat(1), 1)
        self.assertEqual(number_for_seat(7), 7)
        self.assertIsNone(number_for_seat(None))
        self.assertIsNone(number_for_seat("bad"))


if __name__ == "__main__":
    unittest.main()
