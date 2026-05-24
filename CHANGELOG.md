# Changelog

## 2026-05-23

* Added server observations for historical server/player/map snapshots
* Added a health endpoint with version, uptime, request, database, and Steam
  server browser status
* Added valve metrics/servers

## 2026-04-19

* Added Halloween 2025 and Smissmas 2025 official maps to vanilla filtering

## 2026-03-22

* Reworked the server list around Steam IDs to reduce duplicate servers
* Added automatic server categorization

## 2025-10-17

* Updated server discovery to use the Steam Web API

## 2025-07-26

* Added Summer 2025 official maps to vanilla filtering

## 2025-05-25

* Added "All" category filter to find all the servers
* Added extra layer of filters for whitelisted "vanilla" servers
* Added some better moderation tools to detect when a server categorized as
  vanilla isn't
* Modified current analytics to derive from `server_players`

  Should use slightly less data on the server page. Avg Maps/Gamemodes played
  per session should be slightly more accurate

## 2025-05-01

* Added max player count filter
* Added github advertisement in console
* Added way for admins to remove categories from servers

## 2025-04-27

* Modified `server_players` to got more accurate data on what maps are being
  played (currently unused)
* Modified wait time between querying servers from 2.5 minutes to 30 seconds

  This shouldn't effect analytics that much. It should just make the player
  count and the map more accurate when viewing the browser
