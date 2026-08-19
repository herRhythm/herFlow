<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
try {
 $dir=__DIR__.'/data'; if(!is_dir($dir)&&!mkdir($dir,0775,true)&&!is_dir($dir)) throw new RuntimeException('Unable to create data directory.');
 $db=new PDO('sqlite:'.$dir.'/client_feedback.sqlite'); $db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION); $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE,PDO::FETCH_ASSOC);
 $db->exec("CREATE TABLE IF NOT EXISTS recommendations (id INTEGER PRIMARY KEY AUTOINCREMENT,section TEXT NOT NULL,comment TEXT NOT NULL,name TEXT,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)");
 if($_SERVER['REQUEST_METHOD']==='GET'){ $q=$db->query("SELECT id,section,comment,name,strftime('%Y-%m-%d %H:%M',created_at) created_at FROM recommendations ORDER BY id DESC"); echo json_encode(['success'=>true,'comments'=>$q->fetchAll()]); exit; }
 if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);echo json_encode(['success'=>false,'message'=>'Method not allowed.']);exit;}
 $in=json_decode(file_get_contents('php://input')?:'',true); $section=trim((string)($in['section']??'')); $comment=trim((string)($in['comment']??'')); $name=trim((string)($in['name']??''));
 if($section===''||$comment===''){http_response_code(422);echo json_encode(['success'=>false,'message'=>'Section and recommendation are required.']);exit;}
 if(mb_strlen($section)>150||mb_strlen($comment)>5000||mb_strlen($name)>100){http_response_code(422);echo json_encode(['success'=>false,'message'=>'One or more fields are too long.']);exit;}
 $s=$db->prepare('INSERT INTO recommendations(section,comment,name) VALUES(?,?,?)');$s->execute([$section,$comment,$name!==''?$name:null]);
 $q=$db->query("SELECT id,section,comment,name,strftime('%Y-%m-%d %H:%M',created_at) created_at FROM recommendations ORDER BY id DESC");echo json_encode(['success'=>true,'comments'=>$q->fetchAll()]);
} catch(Throwable $e){http_response_code(500);echo json_encode(['success'=>false,'message'=>'Server error: '.$e->getMessage()]);}
