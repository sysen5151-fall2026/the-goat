"""Chapter 3 acceptance-test baseline.

Each test is intentionally red until the product behavior and approved fixtures
exist. A red result here is the expected Chapter 3 deliverable, not evidence of
a passing or failing Wayly product.
"""

import unittest


class SpecificationAcceptanceTests(unittest.TestCase):
    def test_SN1_submit_trip_preferences(self):
        self.fail(
            "Not implemented: validate the approved Planning Request contract."
        )

    def test_SN2_generate_feasible_itinerary_within_30_seconds(self):
        self.fail(
            "Not implemented: apply approved constraints to a frozen itinerary fixture."
        )

    def test_SN3_recommend_only_approved_poi_data(self):
        self.fail(
            "Not implemented: enforce the approved POI evidence and whitelist rules."
        )

    def test_SN4_never_label_missing_route_data_as_validated(self):
        self.fail(
            "Not implemented: validate route status and provide an honest fallback."
        )

    def test_SN5_revision_is_available_before_acceptance(self):
        self.fail(
            "Not implemented: revise and revalidate a proposed itinerary."
        )

    def test_SN6_return_controlled_feedback_for_non_normal_outcomes(self):
        self.fail(
            "Not implemented: return controlled feedback for invalid or unavailable inputs."
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
