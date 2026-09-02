#!/usr/bin/env python3
"""Open (and optionally re-save) a document through LibreOffice with a password.

`soffice --convert-to` cannot pass one, so this drives LibreOffice over UNO instead.
Prints the document's text on success and exits nonzero when the file will not open.
"""
import argparse
import os
import random
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue


def props(**kw):
    return tuple(PropertyValue(Name=k, Value=v) for k, v in kw.items())


def connect(port, profile):
    socket = f'socket,host=localhost,port={port};urp;StarOffice.ComponentContext'
    proc = subprocess.Popen(
        ['soffice', '--headless', '--norestore', f'--accept={socket}',
         f'-env:UserInstallation=file://{profile}'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    local = uno.getComponentContext()
    for _ in range(120):
        try:
            resolver = local.ServiceManager.createInstanceWithContext(
                'com.sun.star.bridge.UnoUrlResolver', local)
            return proc, resolver.resolve('uno:' + socket)
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise SystemExit('LibreOffice did not start')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='source', required=True)
    ap.add_argument('--password', default='')
    ap.add_argument('--out')
    ap.add_argument('--filter', default='writer8')
    ap.add_argument('--store-password', default='')
    args = ap.parse_args()

    port = random.randint(2100, 2999)
    profile = tempfile.mkdtemp(prefix='lo-password-')
    proc, ctx = connect(port, profile)
    try:
        desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        load = {'Hidden': True}
        if args.password:
            load['Password'] = args.password
        doc = desktop.loadComponentFromURL(
            'file://' + os.path.abspath(args.source), '_blank', 0, props(**load))
        if doc is None:
            raise SystemExit('could not open the document')
        print(doc.Text.getString()[:200])
        if args.out:
            store = {'FilterName': args.filter}
            if args.store_password:
                store['Password'] = args.store_password
            doc.storeToURL('file://' + os.path.abspath(args.out), props(**store))
        doc.close(False)
    finally:
        try:
            ctx.ServiceManager.createInstanceWithContext(
                'com.sun.star.frame.Desktop', ctx).terminate()
        except Exception:
            pass
        proc.wait(timeout=30)


if __name__ == '__main__':
    sys.exit(main())
