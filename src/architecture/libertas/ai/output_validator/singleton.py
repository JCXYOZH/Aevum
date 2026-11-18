"""输出校验职责：singleton。"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from libertas.foundation.config import get_data_dir

from .core import OutputValidator
from .models import ValidationResult

_output_validator = OutputValidator()

def get_output_validator() -> OutputValidator:
    return _output_validator

def validate_output(output: str, **kwargs) -> ValidationResult:
    return _output_validator.validate(output, **kwargs)
