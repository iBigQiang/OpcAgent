@echo off
"%OPCAGENT_UV%" run --python 3.12 "%OPCAGENT_SCRIPTS%\doc_diff.py" %*
