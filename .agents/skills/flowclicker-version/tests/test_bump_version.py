import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).parents[1] / "scripts/bump_version.py"
SPEC = importlib.util.spec_from_file_location("bump_version", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BumpVersionTest(unittest.TestCase):
    def test_calculations(self):
        self.assertEqual(MODULE.bumped("1.2.3", "major"), "2.0.0")
        self.assertEqual(MODULE.bumped("1.2.3", "minor"), "1.3.0")
        self.assertEqual(MODULE.bumped("1.2.3", "patch"), "1.2.4")
        self.assertEqual(MODULE.bumped("1.2.3", "none"), "1.2.3")

    def test_sync_idempotency_and_conflict_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cargo = root / "Cargo.toml"
            lock = root / "Cargo.lock"
            cargo.write_text('[package]\nname = "flowclicker"\nversion = "1.0.0"\n')
            lock.write_text('[[package]]\nname = "flowclicker"\nversion = "1.0.0"\n')
            with patch.multiple(MODULE, CARGO=cargo, LOCK=lock), patch.object(MODULE, "head_version", return_value="1.0.0"):
                self.assertEqual(MODULE.apply("minor"), "1.1.0")
                self.assertEqual(MODULE.apply("minor"), "1.1.0")
                self.assertIn('version = "1.1.0"', cargo.read_text())
                self.assertIn('version = "1.1.0"', lock.read_text())
                cargo.write_text(cargo.read_text().replace("1.1.0", "1.2.0"))
                with self.assertRaises(SystemExit):
                    MODULE.apply("minor")


if __name__ == "__main__":
    unittest.main()
