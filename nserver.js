

const express = require('express');
const cors = require('cors');
const app = express();
const bodyParser = require('body-parser');
const serverPort = 5000;
client=require('./config/db.js')

client.connect(err => {
    if (err) {
        console.log('Failed to connect db ' + err)
    } else {
        console.log('Connect to db done!')
    }
})
const startNodeIds = [1553]; // 시작 노드 ID의 배열
const endNodeId = 1565; // 목적지 노드 ID
let minCost = Infinity;
let bestPath = null;

async function findBestPath() {
    for (const startNodeId of startNodeIds) {
        const query = `
      SELECT pd.*, n.node_att, n.bol_width, n.bump_hei, l.link_att, l.grad_deg, ST_AsText(n.node_geom) as node_geom, ST_AsText(l.link_geom) as link_geom
      FROM pgr_dijkstra(
               'SELECT id, node1 as source, node2 as target, 
                       CASE WHEN link_att = 5 THEN 10000 ELSE slopel END as cost
                FROM link',
               ${startNodeId}, 
               ${endNodeId}, 
               false
           ) as pd
      JOIN link as l ON pd.edge = l.id
      JOIN node as n ON pd.end_vid = n.node_id;
    `;

        try {
            const res = await pool.query(query);
            const totalCost = res.rows.reduce((acc, row) => acc + row.cost, 0); // 총 비용 계산

            if (totalCost < minCost && totalCost > 0) { // totalCost가 0보다 커야 유효한 경로가 있음을 의미
                minCost = totalCost;
                bestPath = res.rows;
            }
        } catch (err) {
            console.error('Error executing query', err.stack);
        }
    }

    if (bestPath) {
        console.log('최적의 경로:', bestPath);
        console.log('최소 비용:', minCost);
    } else {
        console.log('조건에 맞는 경로를 찾을 수 없습니다.');
    }
}

findBestPath();
